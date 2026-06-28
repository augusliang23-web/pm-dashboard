const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const match = html.match(/\/\* trend-axis:start \*\/([\s\S]*?)\/\* trend-axis:end \*\//);
assert.ok(match, 'shared trend axis helper is missing');

const context = {};
vm.runInNewContext(`${match[1]}; this.trendXCoordinates = trendXCoordinates;`, context);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.trendXCoordinates(4, 360, 12))),
  [12, 124, 236, 348]
);
assert.ok(html.includes('weekly-trend-axis-label'), 'trend labels must render inside the SVG');
assert.ok(!html.includes('<div class="weekly-trend-labels">'), 'detached trend labels must be removed');
assert.ok(html.includes('Portfolio Summary:'), 'AI prompt must require an explicit portfolio summary');
assert.ok(html.includes('exec-summary-portfolio-lead'), 'portfolio lead needs dedicated rendering');
const promptHelper = html.match(/function addPortfolioSummaryInstruction\(prompt\) \{([\s\S]*?)\n\}/);
assert.ok(promptHelper, 'portfolio summary prompt helper is missing');
const promptContext = {};
vm.runInNewContext(`${promptHelper[0]}; this.addPortfolioSummaryInstruction = addPortfolioSummaryInstruction;`, promptContext);
const revisedPrompt = promptContext.addPortfolioSummaryInstruction(
  '- Return exactly these two section headings, each on its own line: WEEKLY MOVEMENT and MANAGEMENT ASK.\n' +
  '- Never combine multiple projects into one bullet. Use a separate Portfolio: bullet only for a genuinely portfolio-wide point.'
);
assert.ok(revisedPrompt.includes('beginning exactly with "Portfolio Summary:"'));
assert.ok(!revisedPrompt.includes('Use a separate Portfolio: bullet'));

console.log('trend and summary tests passed');
