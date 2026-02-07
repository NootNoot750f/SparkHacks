/**
 * Content script: Injected on all pages, extracts product data on demand.
 * Heuristics for major e-comm (Amazon, eBay, Walmart, etc.) - no deps, fast parse.
 * Responds to popup messages only. Silent otherwise.
 * Edge: Non-shopping pages return null; handles dynamic loads via simple wait.
 */

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractProduct') {
    const product = extractProduct();
    sendResponse(product);
  }
  return true;  // Async response
});

/**
 * Extract product: Title, price, image, URL. Prioritize common selectors.
 * Returns null if no match. Robust: Tries multiple patterns, escapes HTML.
 */
function extractProduct() {
  try {
    const url = window.location.href;
    let title = '';
    let price = '';
    let image = '';
    
    // Amazon
    if (url.includes('amazon.com')) {
      title = document.querySelector('#productTitle')?.innerText.trim() || '';
      const whole = document.querySelector('.a-price-whole')?.innerText?.trim() || '';
      const fraction = document.querySelector('.a-price-fraction')?.innerText?.trim() || '';
      price = (whole || fraction) ? `${whole}${fraction ? '.' + fraction.replace(/[^0-9]/g, '') : ''}` : '';
      image = document.querySelector('#landingImage')?.src || document.querySelector('.imgTagWrapper img')?.src || '';
    }
    // eBay
    else if (url.includes('ebay.com')) {
      title = document.querySelector('h1[data-testid="x-price-primary"] ~ h1')?.innerText.trim() || document.querySelector('h1')?.innerText.trim() || '';
      price = document.querySelector('[data-testid="x-price-primary"]')?.innerText.trim() || '';
      image = document.querySelector('.s-item__image-img')?.src || '';
    }
    // Walmart (general fallback)
    else if (url.includes('walmart.com')) {
      title = document.querySelector('h1')?.innerText.trim() || '';
      price = document.querySelector('.w_iUH7')?.innerText.trim() || '';  // Price span
      image = document.querySelector('[data-automation-id="product-image"]')?.src || '';
    }
    // Generic fallback: Look for h1/title, price patterns, og:image meta
    else {
      title = document.querySelector('h1, [itemprop="name"], .product-title')?.innerText.trim() || document.title.replace(/ - .*$/, '');
      price = findPrice();
      image = document.querySelector('meta[property="og:image"]')?.content || '';
    }
    
    // Clean price (e.g., "$19.99" -> "19.99")
    price = (price || '').toString().replace(/[^0-9.]/g, '');
    
    if (!title || !price) return null;
    
    return {
      title,
      price,
      image,
      url
    };
  } catch (err) {
    console.error('Extraction error:', err);
    return null;
  }
}

/**
 * Find price via regex on text nodes (fallback).
 */
function findPrice() {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  let node;
  while (node = walker.nextNode()) {
    const match = node.textContent.match(/\$[\d,]+\.?\d{0,2}/);
    if (match) return match[0];
  }
  return '';
}

// Optional: Wait for dynamic content (e.g., SPA load) - but keep lightweight, no setTimeout bloat
console.log("Smart Buy Assistant content script loaded");

