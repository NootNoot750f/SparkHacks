/**
 * Popup script for Smart Buy Assistant (Gemini Hack Demo Edition).
 * Enhanced with accessibility, state management, and better UX.
 */

// DOM elements
const enableTracking = document.getElementById('enableTracking');
const analyzeBtn = document.getElementById('analyze');
const outputDiv = document.getElementById('output');
const viewHistoryBtn = document.getElementById('viewHistory');
const loadingDiv = document.getElementById('loading');

// Accessibility controls
const toggleContrast = document.getElementById('toggleContrast');
const fontBtns = document.querySelectorAll('.font-btn');

// Use Chrome Identity OAuth for Google Generative API access.

// State
let isTrackingEnabled = false;
let history = [];
let currentState = 'initial'; // initial, loading, results, error

/**
 * Init: Load stored state, wire events
 */
async function init() {
  try {
    // Load from storage
    const { tracking, hist, highContrast, fontSize } = await chrome.storage.local.get([
      'tracking', 'hist', 'highContrast', 'fontSize'
    ]);
    
    isTrackingEnabled = tracking || false;
    history = hist || [];
    // update auth UI state
    updateAuthStatus();
    
    // UI sync
    enableTracking.checked = isTrackingEnabled;
    viewHistoryBtn.style.display = isTrackingEnabled ? 'block' : 'none';
    
    // Accessibility settings
    if (highContrast) {
      document.body.classList.add('high-contrast');
    }
    setFontSize(fontSize || 'medium');
    
    // Events
    enableTracking.addEventListener('change', toggleTracking);
    analyzeBtn.addEventListener('click', analyzeProduct);
    viewHistoryBtn.addEventListener('click', showHistory);
    document.getElementById('signInBtn').addEventListener('click', signIn);
    document.getElementById('signOutBtn').addEventListener('click', signOut);
    
    // Accessibility events
    if (toggleContrast) {
      toggleContrast.addEventListener('click', toggleHighContrast);
    }
    fontBtns.forEach(btn => {
      btn.addEventListener('click', () => changeFontSize(btn.dataset.size));
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboardNavigation);
    
  } catch (err) {
    showError('Storage load failed: ' + err.message);
  }
}

/**
 * Toggle tracking
 */
function toggleTracking() {
  isTrackingEnabled = enableTracking.checked;
  chrome.storage.local.set({ tracking: isTrackingEnabled });
  viewHistoryBtn.style.display = isTrackingEnabled ? 'block' : 'none';
  
  if (isTrackingEnabled) {
    showMessage('✓ Tracking enabled—your views will inform future suggestions.');
  } else {
    showMessage('Tracking disabled');
  }
}

/**
 * Toggle high contrast mode
 */
function toggleHighContrast() {
  const isHighContrast = document.body.classList.toggle('high-contrast');
  chrome.storage.local.set({ highContrast: isHighContrast });
  announceToScreenReader(
    isHighContrast ? 'High contrast mode enabled' : 'High contrast mode disabled'
  );
}

/**
 * Change font size
 */
function changeFontSize(size) {
  setFontSize(size);
  chrome.storage.local.set({ fontSize: size });
  announceToScreenReader(`Font size changed to ${size}`);
}

/**
 * Set font size
 */
function setFontSize(size) {
  document.body.classList.remove('font-small', 'font-medium', 'font-large');
  document.body.classList.add(`font-${size}`);
  
  fontBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === size);
  });
}

/**
 * Handle keyboard navigation
 */
function handleKeyboardNavigation(e) {
  if (e.key === 'Escape' && currentState !== 'initial') {
    resetToInitial();
  }
}

/**
 * Screen reader announcements
 */
function announceToScreenReader(message) {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  document.body.appendChild(announcement);
  setTimeout(() => announcement.remove(), 1000);
}

/**
 * Reset to initial state
 */
function resetToInitial() {
  currentState = 'initial';
  outputDiv.innerHTML = '';
  showLoading(false);
}

/**
 * Analyze product
 */
async function analyzeProduct() {
  currentState = 'loading';
  showLoading(true);
  outputDiv.innerHTML = '';
  announceToScreenReader('Analyzing product');
  
  try {
    // Validate API key
    if (!GEMINI_API_KEY || !GEMINI_API_KEY.startsWith('AIza')) {
      throw new Error('API key not configured. Please check your .env file.');
    }
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error('No active tab found.');
    
    // Extract product data
    const productData = await chrome.tabs.sendMessage(tab.id, { action: 'extractProduct' });
    
    if (!productData || !productData.title) {
      throw new Error('No product detected. Try an e-commerce site like Amazon, eBay, or Walmart.');
    }
    
    // Log to history if tracking
    if (isTrackingEnabled) {
      history.unshift({ ...productData, timestamp: Date.now() });
      history.splice(50); // Cap at 50
      await chrome.storage.local.set({ hist: history });
    }
    
    // Ask background to run AI; background will use the OAuth token
    const suggestions = await callBackgroundAI(productData);
    
    // Render results
    currentState = 'results';
    renderProduct(productData);
    renderSuggestions(suggestions);
    showLoading(false);
    announceToScreenReader('Analysis complete');
    
  } catch (err) {
    currentState = 'error';
    console.error('Analysis error:', err);
    
    // Fallback for demo
    if (err.message.includes('API key') || err.message.includes('API error')) {
      renderProduct({ 
        title: 'Demo Product (API Error)', 
        price: '29.99', 
        image: '', 
        url: window.location.href 
      });
      renderSuggestions(getDemoSuggestions());
      showMessage('⚠️ Using demo mode. Check your API key configuration.');
    } else {
      showError('Analysis failed: ' + err.message);
    }
    showLoading(false);
    announceToScreenReader('Analysis failed');
  }
}

/**
 * Call Gemini API
 */
async function callBackgroundAI(product) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'analyzeWithAI', product }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response) return reject(new Error('No response from background'));
      if (response.error) return reject(new Error(response.error));
      resolve(response.suggestions || '');
    });
  });
}

// Auth helpers — use background identity flow
function signIn() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'signIn' }, (resp) => {
      if (chrome.runtime.lastError) {
        showError('Sign-in failed: ' + chrome.runtime.lastError.message);
        return resolve(false);
      }
      if (resp && resp.success) {
        updateAuthStatus();
        showMessage('Signed in successfully');
        return resolve(true);
      }
      showError('Sign-in failed');
      resolve(false);
    });
  });
}

function signOut() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'signOut' }, (resp) => {
      updateAuthStatus();
      if (resp && resp.success) showMessage('Signed out');
      else showMessage('Signed out (cache cleared)');
      resolve(true);
    });
  });
}

function updateAuthStatus() {
  chrome.runtime.sendMessage({ action: 'isSignedIn' }, (resp) => {
    const signed = resp && resp.signed;
    document.getElementById('authStatus').textContent = signed ? 'Signed in' : 'Not signed in';
    document.getElementById('signInBtn').style.display = signed ? 'none' : 'inline-block';
    document.getElementById('signOutBtn').style.display = signed ? 'inline-block' : 'none';
  });
}

/**
 * Save API key entered by user
 */
function saveApiKey() {
  const val = document.getElementById('apiKeyInput')?.value?.trim() || '';
  GEMINI_API_KEY = val;
  chrome.storage.local.set({ apiKey: val });
  showMessage(val ? 'API key saved locally.' : 'API key cleared.');
}

/**
 * Render product info
 */
function renderProduct(data) {
  const html = `
    <div class="product-info" role="region" aria-label="Product information">
      <h3>${escapeHtml(data.title)}</h3>
      <p class="product-price">Price: $${escapeHtml(data.price)}</p>
      ${data.image ? `<img src="${escapeHtml(data.image)}" alt="Product image" class="product-image">` : ''}
      <p class="product-url"><small>${escapeHtml(data.url)}</small></p>
    </div>
  `;
  outputDiv.innerHTML += html;
}

/**
 * Render AI suggestions
 */
function renderSuggestions(text) {
  // Parse suggestions (look for numbered lists or bullet points)
  const lines = text.split('\n').filter(line => line.trim());
  const suggestions = lines.filter(line => 
    /^\d+\./.test(line.trim()) || /^[-•*]/.test(line.trim()) || line.length > 10
  );
  
  const html = `
    <div class="suggestions-container" role="region" aria-label="AI suggestions">
      <h3>AI-Powered Suggestions:</h3>
      ${suggestions.map(s => `<div class="suggestion">${escapeHtml(s)}</div>`).join('')}
    </div>
  `;
  outputDiv.innerHTML += html;
}

/**
 * Show browsing history
 */
function showHistory() {
  if (!history.length) {
    showMessage('No history yet—browse with tracking enabled!');
    return;
  }
  
  const html = `
    <div class="history-container" role="region" aria-label="Browsing history">
      <h3>Recent Views (Last 10):</h3>
      ${history.slice(0, 10).map(item => `
        <div class="history-item">
          <strong>${escapeHtml(item.title)}</strong> - $${escapeHtml(item.price)}<br>
          <small>${new Date(item.timestamp).toLocaleString()} | 
          <a href="${escapeHtml(item.url)}" target="_blank">View</a></small>
        </div>
      `).join('')}
    </div>
  `;
  outputDiv.innerHTML = html;
}

/**
 * Demo suggestions fallback
 */
function getDemoSuggestions() {
  return `1. Check eBay for similar items - Often 20-30% cheaper
2. Wait for Amazon Prime Day - Significant discounts expected
3. Compare at Walmart.com - Price match guarantee available
4. Consider refurbished options - Save 40% with warranty
5. Check CamelCamelCamel for price history - Buy at optimal time`;
}

/**
 * UI Helpers
 */
function showLoading(show) {
  loadingDiv.style.display = show ? 'flex' : 'none';
  analyzeBtn.disabled = show;
  analyzeBtn.setAttribute('aria-busy', show);
}

function showMessage(msg) {
  outputDiv.innerHTML = `<div class="message success" role="status">${escapeHtml(msg)}</div>`;
}

function showError(msg) {
  outputDiv.innerHTML = `<div class="message error" role="alert">${escapeHtml(msg)}</div>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
init();