// Policy for tool calls. Not written yet: everything is allowed for now.

function decide() {
  return { verdict: 'allow', reason: '' };
}

function tierOf() {
  return null;
}

module.exports = { decide, tierOf };
