export function renderErrorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>500 — PesaSwap</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Inter", system-ui, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { text-align: center; max-width: 420px; }
    .code { font-size: 4rem; font-weight: 800; letter-spacing: -0.02em; opacity: 0.3; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0.5rem; }
    p { font-size: 0.875rem; color: #a1a1aa; margin-top: 0.75rem; line-height: 1.5; }
    a {
      display: inline-block;
      margin-top: 1.5rem;
      padding: 0.625rem 1.25rem;
      background: #fafafa;
      color: #0a0a0a;
      border-radius: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <p class="code">500</p>
    <h1>Something went wrong</h1>
    <p>PesaSwap encountered an unexpected error. Please try again or contact support if the issue persists.</p>
    <a href="/">Back to dashboard</a>
  </div>
</body>
</html>`;
}
