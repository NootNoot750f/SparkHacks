/**
 * Popup script for Smart Buy Assistant (Gemini Hack Demo Edition).
 * Handles UI events, storage, messaging to content script, and AI API calls.
 * Keeps it snappy: Async all the things, error boundaries for flaky networks.
 * Storage: Tracking state (bool), history (array of {title, url, timestamp}).
 * Hack Note: No user key input—hardcode from .env for demo (swap below). Falls back to mock if missing.
 */

// DOM elements
const enableTracking = document.getElementById('enableTracking');
const analyzeBtn = document.getElementById('analyze');
const outputDiv = document.getElementById('output');
const viewHistoryBtn = document.getElementById('viewHistory');
const loadingDiv = document.getElementById('loading');

// Hardcoded API key (from .env—swap your GEMINI_API_KEY here for demo; never commit!)
const apiKey = 'AIzaYourFreeGeminiKeyFromEnvHere';  // <-- Paste from .env here (e.g., 'AIzaSy...')

// State from storage
let isTrackingEnabled = false;
let history = [];

/**
 * Init: Load stored state, wire events. No key UI—assume hardcoded.
 */
async function init() {
  try {
    // Load from storage (local for incognito split)
    const { tracking, hist } = await chrome.storage.local.get(['tracking', 'hist']);
    isTrackingEnabled = tracking || false;
    history = hist || [];
    
    // UI sync
    enableTracking.checked = isTrackingEnabled;
    viewHistoryBtn.style.display = isTrackingEnabled ? 'block' : 'none';
    
    // Events
    enableTracking.addEventListener('change', toggleTracking);
    analyzeBtn.addEventListener('click', analyzeProduct);
    viewHistoryBtn.addEventListener('click', showHistory);
  } catch (err) {
    showError('Storage load failed: ' + err.message);
  }
}

/**
 * Toggle tracking: Update state, show/hide history btn.
 */
function toggleTracking() {
  isTrackingEnabled = enableTracking.checked;
  chrome.storage.local.set({ tracking: isTrackingEnabled });
  viewHistoryBtn.style.display = isTrackingEnabled ? 'block' : 'none';
  if (isTrackingEnabled) {
    showMessage('Tracking enabled—your views will inform future suggestions.');
  }
}

/**
 * Analyze: Get active tab, extract product, call AI, display.
 */
async function analyzeProduct() {
  showLoading(true);
  outputDiv.innerHTML = '';
  
  try {
    // Key check: Fallback to mock if missing/invalid
    if (!apiKey || !apiKey.startsWith('AIza')) {
      throw new Error('Demo mode: API key not set—using mock suggestions. (Check popup.js for .env swap.)');
    }
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error('No active tab found.');
    
    // Message content script for extraction
    const productData = await chrome.tabs.sendMessage(tab.id, { action: 'extractProduct' });
    
    if (!productData || !productData.title) {
      throw new Error('No product detected on this page. Try an e-commerce site like Amazon.');
    }
    
    // Log to history if tracking
    if (isTrackingEnabled) {
      history.unshift({ ...productData, timestamp: Date.now() });
      // Cap history at 50 for perf
      history.splice(50);
      await chrome.storage.local.set({ hist: history });
    }
    
    // Call AI API
    const suggestions = await callGeminiAPI(productData);
    
    // Render
    renderProduct(productData);
    renderSuggestions(suggestions);
    showLoading(false);
  } catch (err) {
    // Graceful fallback: Mock response for demo
    if (err.message.includes('Demo mode') || err.message.includes('API error')) {
      renderProduct({ title: 'Demo Product', price: 'N/A', image: '', url: window.location.href });
      renderSuggestions(`Demo Suggestion 1: Cheaper alt on eBay for $15 (better reviews).\nDemo Suggestion 2: Similar on Walmart, save 20% with bundle.`);
    } else {
      showError('Analysis failed: ' + err.message);
    }
    showLoading(false);
  }
}

/**
 * Fetch to Gemini API (Google - free tier; see aistudio.google.com for key/limits).
 * Prompt: Tailored for shopping alts. Uses generateContent endpoint.
 */
async function callGeminiAPI(product) {
  const prompt = `Analyze this product: "${product.title}" for $${product.price} at ${product.url}.
  Suggest 3-5 better or cheaper alternatives (include why, est. price, where to buy). Keep concise, helpful, unbiased.`;

  // Gemini endpoint: Key in query, POST body with contents
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{  // Gemini format: Array of {role, parts}
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {  // Tuned for brevity
        maxOutputTokens: 300,
        temperature: 0.7,
      },
    }),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error: ${response.status} (${errText}) - Check key/limits at aistudio.google.com`);
  }
  
  const data = await response.json();
  if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
    throw new Error('Unexpected API response—try a fresh key.');
  }
  
  return data.candidates[0].content.parts[0].text.trim();
}

/**
 * Render extracted product info.
 */
function renderProduct(data) {
  const html = `
    <div class="product-info">
      <strong>${data.title}</strong><br>
      Price: $${data.price}<br>
      ${data.image ? `<img src="${data.image}" alt="Product" style="max-width: 100px; height: auto;">` : ''}<br>
      <small>${data.url}</small>
    </div>
  `;
  outputDiv.innerHTML += html;
}

/**
 * Render AI suggestions as list.
 */
function renderSuggestions(text) {
  const suggestions = text.split('\n').filter(line => line.trim() && !line.startsWith('-'));  // Simple parse
  const html = suggestions.map(s => `<div class="suggestion">${s}</div>`).join('');
  outputDiv.innerHTML += `<h3>Suggestions (via AI):</h3>${html}`;
}

/**
 * Show browsing history (if tracked).
 */
function showHistory() {
  if (!history.length) {
    outputDiv.innerHTML = '<p class="error">No history yet—browse with tracking on!</p>';
    return;
  }
  
  const html = history.slice(0, 10).map(item => `
    <div class="history-item">
      <strong>${item.title}</strong> - $${item.price} <br>
      <small>${new Date(item.timestamp).toLocaleString()} | <a href="${item.url}" target="_blank">View</a></small>
    </div>
  `).join('');
  
  outputDiv.innerHTML = `<h3>Recent Views:</h3>${html}`;
}

/**
 * UI Helpers
 */
function showLoading(show) {
  loadingDiv.style.display = show ? 'block' : 'none';
  analyzeBtn.disabled = show;
}

function showMessage(msg) {
  outputDiv.innerHTML = `<p style="color: green;">${msg}</p>`;
}

function showError(msg) {
  outputDiv.innerHTML = `<p class="error">${msg}</p>`;
}

// Kick off
init();