# Running Custom Playwright Code

Use `run-code` for predictable multi-step batches and advanced scenarios not covered by CLI commands. Prefer inline code when the script is easy to quote. This reduces separate CLI calls, tool round trips, and repeated output. The reduced process and tool-call overhead can improve elapsed time; page navigation and waits still take their normal time. A batch accepts multiple awaited actions, loops, and conditional logic in one function. Check expected content between dependent actions. Use separate CLI calls when an unexpected result requires inspection.

Format the JavaScript for reading. Put statements on separate lines and indent blocks. Do not compress the script into one line to reduce CLI length. Batching reduces tool calls; it does not require minified source.

## Syntax

For compact scripts, use one inline function expression. With a POSIX shell's single-quoted argument, use double quotes in JavaScript string literals and avoid apostrophes in the script:

```bash
playwright-cli -s=my-session --raw run-code 'async page => {
  const heading = page.getByRole("heading", { name: "Example Domain", exact: true });
  await heading.waitFor({ state: "visible" });
  return { url: page.url(), title: await page.title() };
}'
```

For long, hard-to-quote, or reusable code, load the function from a file:

```bash
playwright-cli run-code --filename=./my-script.js
```


The code must be a single function expression, it is wrapped in `(...)` and evaluated.
import/export/require syntax is not supported.

The code runs in an isolated context, not in a full Node.js environment. `require`, `process` and Node modules are not
available. Timers (`setTimeout`, `setInterval`), `fetch`, `URL`, `Buffer`, `crypto`, `AbortController`, `TextEncoder`
and `TextDecoder` are available.

## Heredocs through command substitution

When an inline script becomes long or difficult to quote, use a quoted heredoc inside command substitution. No custom helper or temporary script file is needed. Native `run-code` does not read stdin. Command substitution supplies the source as its code argument. See the [batch execution guidance](../SKILL.md#batch-execution-to-reduce-overhead) for session selection and approval requirements.

```bash
playwright-cli -s=my-session --raw run-code "$(cat <<'JS'
async page => {
  const heading = page.getByRole('heading', { name: 'Example Domain', exact: true });
  await heading.waitFor({ state: 'visible' });
  return { url: page.url(), heading: await heading.textContent() };
}
JS
)"
```

The session must already be open. Use a quoted delimiter such as `<<'JS'` to prevent shell expansion of `$`, backticks, and backslashes. Keep the outer double quotes so the script passes as one argument. Supply a complete function expression, not just a function body. Command substitution removes trailing newlines. A bare `run-code <<'JS'` or `run-code - <<'JS'` is not supported.

Prefer this interface for one-time scripts when review in the conversation matters. The complete submitted source remains visible if tool-call history is retained. Command-line argument-size limits apply. The source can appear in process arguments and tool-call history. Do not embed credentials or other secrets.

Prefer native `--filename` with a version-controlled file for reusable or long workflows, editor diagnostics, tests, and durable review. A filename-only tool call does not record the file contents. Record the exact revision when reproducibility matters. Do not execute a temporary script whose source is neither visible in the tool call nor preserved elsewhere for review.

Tool-call history shows what was submitted. Check execution output and expected page state to verify what succeeded. Both interfaces use native `run-code`; neither changes the execution environment or grants tool permissions. Use `--filename` in native Windows shells.

## Geolocation

```bash
# Grant geolocation permission and set location
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 37.7749, longitude: -122.4194 });
}"

# Set location to London
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
}"

# Clear geolocation override
playwright-cli run-code "async page => {
  await page.context().clearPermissions();
}"
```

## Permissions

```bash
# Grant multiple permissions
playwright-cli run-code "async page => {
  await page.context().grantPermissions([
    'geolocation',
    'notifications',
    'camera',
    'microphone'
  ]);
}"

# Grant permissions for specific origin
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['clipboard-read'], {
    origin: 'https://example.com'
  });
}"
```

## Media Emulation

```bash
# Emulate dark color scheme
playwright-cli run-code "async page => {
  await page.emulateMedia({ colorScheme: 'dark' });
}"

# Emulate light color scheme
playwright-cli run-code "async page => {
  await page.emulateMedia({ colorScheme: 'light' });
}"

# Emulate reduced motion
playwright-cli run-code "async page => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}"

# Emulate print media
playwright-cli run-code "async page => {
  await page.emulateMedia({ media: 'print' });
}"
```

## Wait Strategies

```bash
# Wait for network idle
playwright-cli run-code "async page => {
  await page.waitForLoadState('networkidle');
}"

# Wait for specific element
playwright-cli run-code "async page => {
  await page.locator('.loading').waitFor({ state: 'hidden' });
}"

# Wait for function to return true
playwright-cli run-code "async page => {
  await page.waitForFunction(() => window.appReady === true);
}"

# Wait with timeout
playwright-cli run-code "async page => {
  await page.locator('.result').waitFor({ timeout: 10000 });
}"
```

## Frames and Iframes

```bash
# Work with iframe
playwright-cli run-code "async page => {
  const frame = page.locator('iframe#my-iframe').contentFrame();
  await frame.locator('button').click();
}"

# Get all frames
playwright-cli run-code "async page => {
  const frames = page.frames();
  return frames.map(f => f.url());
}"
```

## File Downloads

```bash
# Handle file download
playwright-cli run-code "async page => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const download = await downloadPromise;
  await download.saveAs('./downloaded-file.pdf');
  return download.suggestedFilename();
}"
```

## Clipboard

```bash
# Read clipboard (requires permission)
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['clipboard-read']);
  return await page.evaluate(() => navigator.clipboard.readText());
}"

# Write to clipboard
playwright-cli run-code "async page => {
  await page.evaluate(text => navigator.clipboard.writeText(text), 'Hello clipboard!');
}"
```

## Page Information

```bash
# Get page title
playwright-cli run-code "async page => {
  return await page.title();
}"

# Get current URL
playwright-cli run-code "async page => {
  return page.url();
}"

# Get page content
playwright-cli run-code "async page => {
  return await page.content();
}"

# Get viewport size
playwright-cli run-code "async page => {
  return page.viewportSize();
}"
```

## JavaScript Execution

```bash
# Execute JavaScript and return result
playwright-cli run-code "async page => {
  return await page.evaluate(() => {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled
    };
  });
}"

# Pass arguments to evaluate
playwright-cli run-code "async page => {
  const multiplier = 5;
  return await page.evaluate(m => document.querySelectorAll('li').length * m, multiplier);
}"
```

## Error Handling

```bash
# Try-catch in run-code
playwright-cli run-code "async page => {
  try {
    await page.getByRole('button', { name: 'Submit' }).click({ timeout: 1000 });
    return 'clicked';
  } catch (e) {
    return 'element not found';
  }
}"
```

## Complex Workflows

```bash
# Login and save state
playwright-cli run-code "async page => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await page.context().storageState({ path: 'auth.json' });
  return 'Login successful';
}"

# Scrape data from multiple pages
playwright-cli run-code "async page => {
  const results = [];
  for (let i = 1; i <= 3; i++) {
    await page.goto(\`https://example.com/page/\${i}\`);
    const items = await page.locator('.item').allTextContents();
    results.push(...items);
  }
  return results;
}"
```
