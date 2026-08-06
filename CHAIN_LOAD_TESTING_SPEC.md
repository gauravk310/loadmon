# LoadMon — Generalized Chain-Based Load Testing Architecture

## 1. Executive Summary & Objective

Currently, **LoadMon** supports single-endpoint load testing (e.g., repeating a single `POST /api/auth/signin` request across concurrent virtual users). 

This document defines the architectural blueprint to evolve LoadMon into a **Generalized Chain-Based Load Testing System**. 

The immediate focus case is the **Student User Flow**:
1. **User Authentication (Login)**: Send `POST /api/auth/signin` with credentials -> capture JWT authentication token & user ID.
2. **Fetch Enrollments**: Send `GET /api/enrollments` using the Bearer token -> capture the student's active enrollment class ID (`enrollmentId`).
3. **Open Selected Enrollment & Get Tests**: Send `GET /api/enrollments/{{ enrollmentId }}/tests` using the dynamic `enrollmentId` -> fetch test details for all virtual users.

---

## 2. Core Architectural Principles

```
  ┌─────────────────────────────────────────────────────────┐
  │                 LoadMon UI (React + Vite)               │
  │     Visual Chain Builder: Step 1 ➔ Step 2 ➔ Step N      │
  └────────────────────────────┬────────────────────────────┘
                               │ Save Config JSON
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │                 LoadMon Backend (Express)               │
  │     Converts JSON Chain Config to Dynamic Scenario YML  │
  └────────────────────────────┬────────────────────────────┘
                               │ Spawns Artillery Runner
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   Artillery Engine                      │
  │  Per-VU Isolation ➔ Execs Step 1 ➔ Captures Vars       │
  │                     ➔ Injects Vars in Step 2 ➔ Step N   │
  └─────────────────────────────────────────────────────────┘
```

1. **Per-Virtual-User Context Isolation**: Each simulated user (VU) runs through the scenario independently, keeping its own session state, extracted tokens, and variable context.
2. **Dynamic Variable Extraction (`capture`)**: Allows responses from earlier steps (JSON keys, headers, regex) to populate variables for subsequent steps.
3. **Variable Interpolation (`{{ varName }}`)**: Supports mustache syntax across URLs, headers, query params, and JSON payloads.
4. **Step-Level Execution & Think Time**: Configurable delays (`think`), timeout rules, and validation assertions per step.

---

## 3. Generalized Configuration Schema (`config.json`)

To support multi-step dynamic chains, `config.json` expands from single target endpoints to an array of sequential **scenarios** and **steps**.

```json
{
  "selectedAppId": "app_default",
  "applications": [
    {
      "id": "app_default",
      "name": "AssessQ Backend",
      "appUrl": "http://localhost:3000",
      "serverUrl": "http://localhost:5000",
      "hostname": "localhost:5000"
    }
  ],
  "httpTimeout": 30,
  "maxSockets": 5000,
  "randomIp": true,
  "scenarioName": "Student Test Access Flow",
  "steps": [
    {
      "id": "step_1",
      "name": "Student Login",
      "method": "POST",
      "endpoint": "/api/auth/signin",
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "email": "{{ email }}",
        "password": "{{ password }}"
      },
      "capture": [
        {
          "json": "$.token",
          "as": "authToken"
        },
        {
          "json": "$.user.id",
          "as": "userId"
        }
      ],
      "think": 1
    },
    {
      "id": "step_2",
      "name": "Get Enrollments",
      "method": "GET",
      "endpoint": "/api/enrollments",
      "headers": {
        "Authorization": "Bearer {{ authToken }}"
      },
      "capture": [
        {
          "json": "$.enrollments[0]._id",
          "as": "enrollmentId"
        }
      ],
      "think": 2
    },
    {
      "id": "step_3",
      "name": "Get Enrollment Tests",
      "method": "GET",
      "endpoint": "/api/enrollments/{{ enrollmentId }}/tests",
      "headers": {
        "Authorization": "Bearer {{ authToken }}"
      },
      "think": 1
    }
  ],
  "phases": [
    { "duration": 60, "arrivalRate": 10, "name": "Student Ramp Load" }
  ]
}
```

---

## 4. Backend Dynamic Artillery YAML Generator

The backend (`routes/tests.js`) translates the `steps` array into standard Artillery scenario flows with `capture` definitions.

### Dynamic YAML Generator Code (`buildChainYaml`)

```javascript
function buildChainYaml(config, phases) {
  const steps = config.steps || [];
  
  // Format phases YAML
  let phasesYaml = '';
  if (phases && phases.length > 0) {
    phases.forEach(p => {
      phasesYaml += `\n        - duration: ${p.duration}\n          arrivalRate: ${p.arrivalRate}`;
      if (p.rampTo) phasesYaml += `\n          rampTo: ${p.rampTo}`;
      if (p.name)   phasesYaml += `\n          name: "${p.name}"`;
    });
  } else {
    phasesYaml = `\n        - duration: 30\n          arrivalRate: 5\n          name: "Quick Test"`;
  }

  // Format steps into flow sequence
  let flowYaml = '      - function: "assignUser"\n';

  steps.forEach((step) => {
    const method = step.method.toLowerCase();
    
    flowYaml += `      - ${method}:\n`;
    flowYaml += `          url: "${step.endpoint}"\n`;

    // Headers
    const headers = step.headers || {};
    let headersYaml = '';
    if (config.randomIp) {
      headersYaml += `\n            X-Forwarded-For: "{{ randomIP }}"`;
    }
    Object.entries(headers).forEach(([k, v]) => {
      headersYaml += `\n            ${k}: "${v}"`;
    });
    if (headersYaml) {
      flowYaml += `          headers:${headersYaml}\n`;
    }

    // Body
    if (['post', 'put', 'patch'].includes(method) && step.body) {
      let bodyString = typeof step.body === 'string' ? step.body : JSON.stringify(step.body, null, 2);
      // Format indented lines for YAML
      const indentedBody = bodyString.split('\n').map(line => `            ${line}`).join('\n');
      flowYaml += `          json:\n${indentedBody}\n`;
    }

    // Capture variables from response
    if (step.capture && step.capture.length > 0) {
      flowYaml += `          capture:\n`;
      step.capture.forEach(c => {
        if (c.json) {
          flowYaml += `            - json: "${c.json}"\n              as: "${c.as}"\n`;
        } else if (c.header) {
          flowYaml += `            - header: "${c.header}"\n              as: "${c.as}"\n`;
        }
      });
    }

    // Response Logger Hook
    flowYaml += `          afterResponse: "logResponse"\n`;

    // Think time (delay between requests)
    if (step.think) {
      flowYaml += `      - think: ${step.think}\n`;
    }
  });

  return `config:
  target: "${config.serverUrl}"
  defaults:
    headers:
      Content-Type: "application/json"
      Origin: "${config.appUrl}"
  processor: "./processor.js"
  http:
    timeout: ${config.httpTimeout || 30}
    maxSockets: ${config.maxSockets || 5000}
  environments:
    custom:
      phases:${phasesYaml}

scenarios:
  - name: "${config.scenarioName || 'Chain Load Test'}"
    flow:
${flowYaml}`;
}
```

---

## 5. Enhanced Processor (`artillery/processor.js`)

The Artillery processor handles reading student credentials from `userData.json` and tracking metrics across dynamic steps:

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

const userDataFile = process.env.USERDATA_PATH || path.join(__dirname, '..', 'uploads', 'userData.json');
let userData = [];
try {
  userData = JSON.parse(fs.readFileSync(userDataFile, 'utf-8'));
} catch (e) {
  console.error(`Could not load userData: ${e.message}`);
}

let userIndex = 0;

function assignUser(userContext, events, done) {
  if (!userData.length) return done(new Error('No user data loaded'));

  const index = userIndex % userData.length;
  const user = userData[index];
  userIndex++;

  // Bind CSV/JSON credentials to VU context
  Object.entries(user).forEach(([key, val]) => {
    userContext.vars[key] = val;
  });

  userContext.vars.randomIP = generateRandomIP();
  return done();
}

function logResponse(requestParams, response, context, ee, next) {
  const status = response.statusCode;
  const url = requestParams.url;
  const isSuccess = status >= 200 && status < 300;

  if (!isSuccess) {
    console.log(`❌ Step Failed [${status}] | URL: ${url} | VU Email: ${context.vars.email}`);
  }

  ee.emit('counter', `http.codes.${status}`, 1);
  return next();
}

function generateRandomIP() {
  return `${Math.floor(Math.random()*200+1)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254+1)}`;
}

module.exports = { assignUser, logResponse };
```

---

## 6. Student Flow Execution Example

### Step 1: Login (`POST /api/auth/signin`)
- **Payload**: `{"email": "{{ email }}", "password": "{{ password }}"}`
- **Capture**: `$.token` -> `authToken`

### Step 2: Get Enrollments (`GET /api/enrollments`)
- **Headers**: `Authorization: Bearer {{ authToken }}`
- **Capture**: `$.enrollments[0]._id` -> `enrollmentId`

### Step 3: Get Tests (`GET /api/enrollments/{{ enrollmentId }}/tests`)
- **Headers**: `Authorization: Bearer {{ authToken }}`
- **Verification**: Asserts list of available tests for the dynamic `enrollmentId` extracted in Step 2.

---

## 7. Frontend UI Integration Plan (`ui/src/pages/Configure.jsx`)

1. **Step Sequence Cards**: Display steps as reorderable, collapsible cards with visual badges (`POST`, `GET`, `PUT`, `DELETE`).
2. **Variable Capture Panel**: Interactive table per step allowing users to define `jsonPath` (e.g. `$.data.token`) and target variable name `as` (e.g. `authToken`).
3. **Live Auto-Suggest**: When typing `{{`, show auto-complete dropdown of available user fields (from CSV) and captured step variables.
4. **Step Re-ordering & Deletion**: Buttons to Move Up, Move Down, Delete, or Duplicate steps.

---

## 8. Rollout Phases

- [x] **Phase 1 (Specification)**: Publish `CHAIN_LOAD_TESTING_SPEC.md`.
- [ ] **Phase 2 (Backend)**: Upgrade `routes/tests.js` to build dynamic YAML with multi-step `capture` support.
- [ ] **Phase 3 (UI Builder)**: Update `Configure.jsx` to render multi-step chain builder.
- [ ] **Phase 4 (Reporting)**: Expand Dashboard metrics to display step-by-step latency & error breakdowns.
