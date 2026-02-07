// Background service worker: performs AI calls on behalf of the popup
// Listens for messages of action 'analyzeWithAI' and returns suggestions.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyzeWithAI') {
    handleAnalyze(message.product).then(result => sendResponse({ suggestions: result })).catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.action === 'signIn') {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) return sendResponse({ success: false, error: chrome.runtime.lastError?.message });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'signOut') {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) return sendResponse({ success: true });
      chrome.identity.removeCachedAuthToken({ token }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.action === 'isSignedIn') {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      const signed = !!token && !chrome.runtime.lastError;
      sendResponse({ signed });
    });
    return true;
  }
});

async function handleAnalyze(product) {
  // Ensure we have an OAuth token (non-interactive - if none, instruct signer to sign in)
  const token = await getTokenSilent();
  if (!token) throw new Error('Not signed in. Please sign in with Google to enable AI suggestions.');

  const prompt = `Analyze this product: "${product.title}" priced at $${product.price} from ${product.url}.\n\nProvide 3-5 actionable shopping suggestions:\n- Better or cheaper alternatives\n- Where to buy (specific stores/sites)\n- Estimated prices\n- Why each alternative is better\n\nKeep suggestions concise, helpful, and unbiased. Format as a numbered list.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 500,
      temperature: 0.7
    }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Unexpected API response format');
  return text.trim();
}

function getTokenSilent() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) return resolve(null);
      resolve(token);
    });
  });
}
