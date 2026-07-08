import { Agent } from '../src/agent.js';
import { Orchestrator } from '../src/orchestrator.js';
import { getProvider } from '../src/providers/index.js';

// Simple Mock framework
let mockResponses = [];
let mockCallCount = 0;

// Override chat method on providers dynamically
const providersToMock = ['gemini', 'openai', 'anthropic', 'ollama'];
for (const name of providersToMock) {
  const providerInstance = getProvider(name);
  providerInstance.chat = async ({ systemPrompt, messages, model }) => {
    mockCallCount++;
    const nextResponse = mockResponses.shift() || { 
      content: `Mock response ${mockCallCount}`,
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } 
    };
    return nextResponse;
  };
}

async function runTests() {
  console.log('Running Multi-Agent System Offline Logic Tests (with Token Optimization)...\n');

  const agent1 = new Agent({
    name: 'Planner',
    role: 'Planner Role',
    instructions: 'Create a plan.',
    provider: 'gemini'
  });

  const agent2 = new Agent({
    name: 'Developer',
    role: 'Dev Role',
    instructions: 'Write code.',
    provider: 'openai'
  });

  const orchestrator = new Orchestrator({
    agents: [agent1, agent2],
    supervisorProvider: 'gemini'
  });

  // Test 1: Sequential Flow
  console.log('--- Test 1: Sequential Flow ---');
  mockResponses = [
    { 
      content: 'Plan details: 1. Setup, 2. Build.', 
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } 
    },
    { 
      content: 'Code details: console.log("done");', 
      usage: { promptTokens: 150, completionTokens: 50, totalTokens: 200 } 
    }
  ];
  mockCallCount = 0;

  const seqResult = await orchestrator.runSequential('Build a web application', (agent, text, isThinking) => {
    if (!isThinking) {
      console.log(`[${agent} spoke]: ${text}`);
    }
  });

  const passedSeq = seqResult.finalOutput === 'Code details: console.log("done");' && 
                    seqResult.tokenStats.totalTokens === 320 &&
                    mockCallCount === 2;

  if (passedSeq) {
    console.log('✔ Test 1 passed: Sequential chain and token tracking work correctly.\n');
  } else {
    console.error('✗ Test 1 failed! Result:', seqResult, 'Calls:', mockCallCount);
    process.exit(1);
  }

  // Test 2: Collaborative Supervisor Flow (with dynamic speaker and Synthesis)
  console.log('--- Test 2: Collaborative Flow ---');
  mockResponses = [
    { 
      content: 'Planner', 
      usage: { promptTokens: 30, completionTokens: 5, totalTokens: 35 } // Supervisor picks Planner
    },
    { 
      content: 'Here is the plan for building a system.', 
      usage: { promptTokens: 110, completionTokens: 40, totalTokens: 150 } // Planner speaks
    },
    { 
      content: 'Developer', 
      usage: { promptTokens: 40, completionTokens: 5, totalTokens: 45 } // Supervisor picks Developer
    },
    { 
      content: 'I have written code. [FINISHED]', 
      usage: { promptTokens: 160, completionTokens: 80, totalTokens: 240 } // Developer speaks and finishes
    },
    { 
      content: 'Synthesized Solution: Complete Code base.', 
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } // Synthesizer speaks
    }
  ];
  mockCallCount = 0;

  const collabResult = await orchestrator.runCollaborative('Build a system', 5, (agent, text, isThinking) => {
    if (!isThinking) {
      console.log(`[${agent} spoke]: ${text}`);
    }
  });

  const expectedTotalTokens = 35 + 150 + 45 + 240 + 300; // 770
  const passedCollab = collabResult.finalOutput.includes('Synthesized Solution:') && 
                       collabResult.tokenStats.totalTokens === expectedTotalTokens &&
                       mockCallCount === 5;

  if (passedCollab) {
    console.log('✔ Test 2 passed: Collaborative Supervisor routing, synthesis, and token reports work correctly.\n');
  } else {
    console.error('✗ Test 2 failed! Result:', collabResult, 'Calls:', mockCallCount);
    process.exit(1);
  }

  console.log('All tests passed successfully!');
}

runTests().catch(err => {
  console.error('Tests failed with error:', err);
  process.exit(1);
});
