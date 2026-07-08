import { getProvider } from './providers/index.js';
import { isProviderConfigured } from './config.js';
import { BUILTIN_TOOLS, parseToolCall } from './tools.js';
import { callTool as callMcpTool } from './mcpclient.js';
import { Agent } from './agent.js';

export class Orchestrator {
  /**
   * @param {Object} params
   * @param {Array<import('./agent.js').Agent>} params.agents - List of agents in the team
   * @param {string} [params.supervisorProvider] - Provider for coordinator selection
   * @param {string} [params.supervisorModel] - Model for coordinator selection
   * @param {Array<{server,name,description}>} [params.mcpTools] - Bridged MCP tools available to agents
   */
  constructor({ agents, supervisorProvider = 'gemini', supervisorModel, toolPolicy = 'all', mcpTools = [] }) {
    this.agents = agents;
    this.agentsMap = new Map(agents.map(a => [a.name.toLowerCase(), a]));
    this.supervisorProvider = supervisorProvider;
    this.supervisorModel = supervisorModel;
    // 'all' = every tool runs · 'read' = view/list only, writes & commands blocked (plan / safe mode) · 'none' = no tools
    this.toolPolicy = toolPolicy;
    this.mcpTools = mcpTools;
    this.mcpPrompt = buildMcpPrompt(mcpTools);
    
    // Initialize token statistics tracking
    this.tokenStats = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      breakdown: {}
    };
  }

  resetTokenStats() {
    this.tokenStats = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      breakdown: {}
    };
  }

  recordTokens(agentName, usage) {
    if (!usage) return;
    const p = usage.promptTokens || 0;
    const c = usage.completionTokens || 0;
    const t = usage.totalTokens || (p + c);

    this.tokenStats.promptTokens += p;
    this.tokenStats.completionTokens += c;
    this.tokenStats.totalTokens += t;

    if (!this.tokenStats.breakdown[agentName]) {
      this.tokenStats.breakdown[agentName] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    this.tokenStats.breakdown[agentName].promptTokens += p;
    this.tokenStats.breakdown[agentName].completionTokens += c;
    this.tokenStats.breakdown[agentName].totalTokens += t;
  }

  /**
   * Runs the agents sequentially: User -> Agent A -> Agent B -> Agent C
   * Each agent receives the user task and the work history of the previous agents.
   */
  async runSequential(task, onAgentSpeak) {
    this.resetTokenStats();
    let currentInput = task;
    const history = [];

    for (const agent of this.agents) {
      if (onAgentSpeak) onAgentSpeak(agent.name, 'Thinking...', true);

      // Context construction
      const messages = [
        { role: 'user', content: `Task: ${task}` }
      ];

      if (history.length > 0) {
        // Optimize input: only output the last agent's result in full, others as small summaries to save tokens
        const historyText = history.map((h, i) => {
          if (i === history.length - 1) {
            return `### Agent ${h.agent}'s Complete Output (Immediate Input):\n${h.content}`;
          } else {
            return `### Agent ${h.agent}'s Output Summary:\n${h.content.substring(0, 300)}... (Truncated for optimization)`;
          }
        }).join('\n\n');

        messages.push({
          role: 'user',
          content: `Here are the previous steps completed by other agents in the chain:\n\n${historyText}`
        });
      }

      messages.push({
        role: 'user',
        content: `Please process the task now. Current focus / input data:\n${currentInput}`
      });

      try {
        // Same tool-capable turn as collaborative mode, so agents can read/write files & run commands here too.
        const response = await this.runAgentWithTools(agent, messages, onAgentSpeak);

        currentInput = response.content;
        history.push({ agent: agent.name, content: currentInput });

        if (onAgentSpeak) await onAgentSpeak(agent.name, currentInput, false, response.usage);
      } catch (error) {
        if (onAgentSpeak) onAgentSpeak(agent.name, `Error: ${error.message}`, false);
        throw error;
      }
    }

    return {
      finalOutput: currentInput,
      history: history,
      tokenStats: this.tokenStats
    };
  }

  /**
   * Runs a collaborative chat discussion between agents.
   * A Coordinator LLM selects the next speaker based on context, until [FINISHED] or max turns is reached.
   */
  async runCollaborative(task, maxTurns = 6, onAgentSpeak) {
    this.resetTokenStats();
    const discussionHistory = [];
    let turn = 0;
    let taskCompleted = false;

    if (onAgentSpeak) {
      onAgentSpeak('System', `Starting collaborative session. Max turns: ${maxTurns}.\nTask: "${task}"`, false);
    }

    while (turn < maxTurns && !taskCompleted) {
      // 1. Select who should speak next
      const nextAgentName = await this.selectNextSpeaker(task, discussionHistory);

      if (nextAgentName === 'FINISHED') {
        if (onAgentSpeak) onAgentSpeak('System', 'Coordinator marked task as [FINISHED].', false);
        taskCompleted = true;
        break;
      }

      const activeAgent = this.agentsMap.get(nextAgentName.toLowerCase());
      if (!activeAgent) {
        // Fallback: round-robin if supervisor returns invalid name
        const fallback = this.agents[turn % this.agents.length];
        if (onAgentSpeak) {
          onAgentSpeak('System', `Coordinator selected invalid agent "${nextAgentName}". Routing to "${fallback.name}".`, false);
        }
        const { content, usage } = await this.executeAgentTurn(fallback, task, discussionHistory, onAgentSpeak);
        if (content.includes('[FINISHED]')) taskCompleted = true;
      } else {
        const { content, usage } = await this.executeAgentTurn(activeAgent, task, discussionHistory, onAgentSpeak);
        if (content.includes('[FINISHED]')) taskCompleted = true;
      }

      turn++;
    }

    if (turn >= maxTurns && !taskCompleted) {
      if (onAgentSpeak) {
        onAgentSpeak('System', `Reached maximum collaboration turns (${maxTurns}). Synthesis final product...`, false);
      }
    }

    // Synthesis Phase: combine the conference into one clean product.
    // Skip it when there's nothing to combine (a single agent) — the last message IS the product.
    // Saves a full LLM call per run.
    let finalProduct;
    if (this.agents.length <= 1 && discussionHistory.length) {
      finalProduct = discussionHistory[discussionHistory.length - 1].content;
    } else {
      if (onAgentSpeak) onAgentSpeak('System', 'Synthesizing final product...', true);
      finalProduct = await this.synthesizeFinalProduct(task, discussionHistory);
    }

    return {
      finalOutput: finalProduct,
      history: discussionHistory,
      tokenStats: this.tokenStats
    };
  }

  async executeAgentTurn(agent, task, discussionHistory, onAgentSpeak) {
    if (onAgentSpeak) onAgentSpeak(agent.name, 'Thinking...', true);

    const messages = [
      {
        role: 'user',
        content: `Goal: ${task}\n\nHere is the ongoing collaborative discussion history between our agent team. Please review and provide your input/next step.`
      }
    ];

    // CONTEXT PRUNING: Keep only last 4 messages in full. Prepend older ones as summarized placeholders.
    const maxWindow = 4;
    let relevantHistory = discussionHistory;
    if (discussionHistory.length > maxWindow) {
      const prunedCount = discussionHistory.length - maxWindow;
      messages.push({
        role: 'user',
        content: `[System Notice: ${prunedCount} older conversation turns have been pruned from active context to optimize token usage. Only the last ${maxWindow} turns are shown in full below.]`
      });
      relevantHistory = discussionHistory.slice(-maxWindow);
    }

    // Add relevant discussion history. Prefix others by @handle so agents naturally address teammates as @name.
    const handle = (n) => '@' + String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    relevantHistory.forEach(entry => {
      if (entry.agent === agent.name) {
        messages.push({ role: 'assistant', content: entry.content });
      } else {
        messages.push({ role: 'user', content: `${handle(entry.agent)} (${entry.role}): ${entry.content}` });
      }
    });

    try {
      const response = await this.runAgentWithTools(agent, messages, onAgentSpeak);

      discussionHistory.push({
        agent: agent.name,
        role: agent.role,
        content: response.content
      });

      if (onAgentSpeak) await onAgentSpeak(agent.name, response.content, false, response.usage);
      return { content: response.content, usage: response.usage };
    } catch (error) {
      if (onAgentSpeak) onAgentSpeak(agent.name, `Error: ${error.message}`, false);
      throw error;
    }
  }

  /**
   * Runs one agent turn, executing any workspace tools it requests (view/write file, list dir, run command)
   * and feeding the output back until the agent stops calling tools. Shared by both collaboration modes.
   * Records tokens for every model call. Returns the agent's final response.
   */
  async runAgentWithTools(agent, messages, onAgentSpeak) {
    let response;
    let toolCallCount = 0;
    const maxToolCalls = 5;

    while (toolCallCount < maxToolCalls) {
      // Inject bridged MCP tool list (if any) so the agent knows it can call them.
      response = await agent.respond(messages, this.mcpPrompt ? { extraSystem: this.mcpPrompt } : {});
      this.recordTokens(agent.name, response.usage);

      const toolCall = parseToolCall(response.content);
      if (!toolCall) break; // no tool requested — turn complete

      toolCallCount++;
      const isMcp = toolCall.name === 'mcp';
      const tool = BUILTIN_TOOLS.find(t => t.name === toolCall.name);
      const MUTATING = ['write_file', 'run_command'];
      const blocked = this.toolPolicy === 'none' || (this.toolPolicy === 'read' && MUTATING.includes(toolCall.name));

      if (onAgentSpeak) {
        const label = isMcp ? `mcp:${toolCall.params.server}/${toolCall.params.name}` : toolCall.name;
        onAgentSpeak('System', `${agent.name} ${blocked ? 'blocked from' : 'is executing'} tool: ${label}`, false);
      }

      let output;
      if (blocked) {
        output = `[blocked: "${toolCall.name}" is disabled in this mode (read-only). Describe the change in your reply instead of applying it.]`;
      } else if (toolCall.name === 'subagent') {
        // Delegate a subtask to a fresh sub-agent (same provider) and return its result.
        const subRole = toolCall.params.role || 'Assistant';
        const subTask = toolCall.params.content || toolCall.params.task || '';
        if (!subTask) { output = '[subagent needs a task in the tag body]'; }
        else {
          try {
            const sub = new Agent({
              name: `sub-${subRole}`, role: subRole,
              instructions: 'You are a focused sub-agent spawned to handle one subtask. Complete it concisely and return only the result.',
              provider: agent.providerName, model: agent.model,
            });
            const subRes = await sub.respond([{ role: 'user', content: subTask }]);
            this.recordTokens(`${agent.name}/sub`, subRes.usage);
            output = subRes.content;
          } catch (e) { output = `Sub-agent error: ${e.message}`; }
        }
      } else if (isMcp) {
        // Bridged MCP call — body of the tag is the JSON arguments.
        try {
          const args = toolCall.params.content ? JSON.parse(toolCall.params.content) : {};
          output = await callMcpTool(toolCall.params.server, toolCall.params.name, args);
        } catch (e) {
          output = `MCP error: ${e.message}`;
        }
      } else if (tool) {
        try {
          output = await tool.execute(toolCall.params);
        } catch (e) {
          output = `Error executing tool: ${e.message}`;
        }
      } else {
        output = `Error: Tool "${toolCall.name}" is not supported.`;
      }

      if (onAgentSpeak) {
        onAgentSpeak('System', `Tool output received (${output.length} bytes)`, false);
      }

      // Feed the tool call + result back so the agent sees it on the next iteration.
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: `[Tool Output]:\n${output}` });

      if (onAgentSpeak) onAgentSpeak(agent.name, `Processing tool output (step ${toolCallCount})...`, true);
    }

    if (toolCallCount >= maxToolCalls && onAgentSpeak) {
      onAgentSpeak('System', `Tool execution limit reached for this turn (${maxToolCalls}).`, false);
    }

    return response;
  }

  async selectNextSpeaker(task, discussionHistory) {
    if (this.agents.length === 1) return this.agents[0].name;

    // Determine which provider to use for coordinator/supervisor
    let providerName = this.supervisorProvider;
    if (!isProviderConfigured(providerName)) {
      // Find any configured API provider
      for (const p of ['gemini', 'openai', 'anthropic']) {
        if (isProviderConfigured(p)) {
          providerName = p;
          break;
        }
      }
    }

    let provider;
    try {
      provider = getProvider(providerName);
    } catch {
      // If no API providers are configured, fallback to round-robin
      return this.getNextRoundRobinSpeaker(discussionHistory);
    }

    const agentList = this.agents.map(a => `- ${a.name}: ${a.role}`).join('\n');
    
    // Optimize Supervisor input: keep only recent dialogue snippets
    const recentHistory = discussionHistory.slice(-4).map(h => `[${h.agent}]: ${h.content.substring(0, 150)}${h.content.length > 150 ? '...' : ''}`).join('\n\n');

    const systemPrompt = `You are the Coordinator. Pick which agent speaks next to move the task forward.
Agents:
${agentList}

Rules:
- Choose the agent whose expertise is most needed now (code written → reviewer; plan proposed → builder; etc.). Avoid picking the same agent repeatedly if others are needed.
- If the goal is fully met, output FINISHED.
- Output ONLY the chosen agent's name (exact capitalization) or FINISHED. Nothing else, no quotes.`;

    const messages = [
      {
        role: 'user',
        content: `Goal: ${task}\n\nRecent History:\n${recentHistory || 'No dialogue yet.'}\n\nWhich agent should speak next? (${this.agents.map(a => a.name).join(', ')} or "FINISHED")`
      }
    ];

    try {
      const response = await provider.chat({
        systemPrompt,
        messages,
        model: this.supervisorModel,
        temperature: 0.1
      });

      // Track tokens
      this.recordTokens('Supervisor', response.usage);

      const decision = response.content.trim().replace(/['"]/g, '');
      if (decision.toUpperCase() === 'FINISHED') return 'FINISHED';

      const matchedAgent = this.agents.find(a => a.name.toLowerCase() === decision.toLowerCase());
      return matchedAgent ? matchedAgent.name : this.getNextRoundRobinSpeaker(discussionHistory);
    } catch (err) {
      return this.getNextRoundRobinSpeaker(discussionHistory);
    }
  }

  getNextRoundRobinSpeaker(discussionHistory) {
    if (discussionHistory.length === 0) return this.agents[0].name;
    const lastSpeaker = discussionHistory[discussionHistory.length - 1].agent;
    const idx = this.agents.findIndex(a => a.name === lastSpeaker);
    return this.agents[(idx + 1) % this.agents.length].name;
  }

  /**
   * Synthesis Phase: Synthesizes the conference history into a final clean product.
   */
  async synthesizeFinalProduct(task, discussionHistory) {
    if (discussionHistory.length === 0) return 'No conference entries to synthesize.';

    // Choose coordinator provider
    let providerName = this.supervisorProvider;
    if (!isProviderConfigured(providerName)) {
      for (const p of ['gemini', 'openai', 'anthropic']) {
        if (isProviderConfigured(p)) {
          providerName = p;
          break;
        }
      }
    }

    let provider;
    try {
      provider = getProvider(providerName);
    } catch {
      // Fallback
      return discussionHistory[discussionHistory.length - 1].content;
    }

    const conversationStr = discussionHistory.map(h => `[Agent ${h.agent} (${h.role})]:\n${h.content}`).join('\n\n');

    const systemPrompt = `You are the Synthesizer. Compile the team's discussion into the single best final deliverable for the user.
Task: ${task}

Rules:
- Output ONLY the finished product (final code, plan, or answer). No meta-commentary, no mention of the agents or the discussion.
- Merge the best work; resolve conflicts and fill any placeholders left open.
- Keep every complete code block. Be direct — no preamble or filler.`;

    const messages = [
      {
        role: 'user',
        content: `Here is the full discussion log:\n\n${conversationStr}\n\nProduce the final clean synthesized response.`
      }
    ];

    try {
      const response = await provider.chat({
        systemPrompt,
        messages,
        model: this.supervisorModel,
        temperature: 0.2
      });

      // Track tokens
      this.recordTokens('Synthesizer', response.usage);
      return response.content;
    } catch (err) {
      return discussionHistory[discussionHistory.length - 1].content;
    }
  }
}

// Build the per-turn system snippet that tells agents which MCP tools they can call, and how.
function buildMcpPrompt(mcpTools) {
  if (!mcpTools || !mcpTools.length) return '';
  const list = mcpTools.map(t => `- server "${t.server}", tool "${t.name}": ${t.description}`).join('\n');
  return `Connected MCP tools. To call one, emit a single block tag whose BODY is the JSON arguments, then STOP:
<tool:mcp server="SERVER" name="TOOL">{ ...json arguments... }</tool:mcp>
Available:
${list}`;
}
