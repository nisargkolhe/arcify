/**
 * Website Name Extractor - Simplified website name resolution utility
 * 
 * Purpose: Extract clean, recognizable website names using curated mapping and hostname parsing
 * Key Functions: 2-tier fallback system for optimal performance and zero latency
 * Architecture: Standalone utility with synchronous operations only
 * 
 * Critical Notes:
 * - Tier 1: Curated mapping for popular sites (instant, high quality)
 * - Tier 2: Hostname parsing fallback (reliable, universal)
 * - Synchronous operation ensures zero latency for instant suggestions
 * - No Chrome API dependencies for maximum compatibility
 */

export class WebsiteNameExtractor {
    constructor() {
        // Simplified - no caching needed for synchronous operations
    }

    // Curated mapping for popular websites (Tier 1)
    static POPULAR_SITES = {
        'google.com': 'Google',
        'github.com': 'GitHub',
        'youtube.com': 'YouTube',
        'facebook.com': 'Facebook',
        'meta.com': 'Meta',
        'amazon.com': 'Amazon',
        'netflix.com': 'Netflix',
        'apple.com': 'Apple',
        'microsoft.com': 'Microsoft',
        'twitter.com': 'Twitter',
        'x.com': 'X',
        'linkedin.com': 'LinkedIn',
        'instagram.com': 'Instagram',
        'tiktok.com': 'TikTok',
        'spotify.com': 'Spotify',
        'reddit.com': 'Reddit',
        'wikipedia.org': 'Wikipedia',
        'stackoverflow.com': 'Stack Overflow',
        'discord.com': 'Discord',
        'slack.com': 'Slack',
        'zoom.us': 'Zoom',
        'dropbox.com': 'Dropbox',
        'notion.so': 'Notion',
        'figma.com': 'Figma',
        'canva.com': 'Canva',
        'adobe.com': 'Adobe',
        'atlassian.com': 'Atlassian',
        'salesforce.com': 'Salesforce',
        'shopify.com': 'Shopify',
        'stripe.com': 'Stripe',
        'paypal.com': 'PayPal',
        'venmo.com': 'Venmo',
        'airbnb.com': 'Airbnb',
        'uber.com': 'Uber',
        'lyft.com': 'Lyft',
        'pinterest.com': 'Pinterest',
        'tumblr.com': 'Tumblr',
        'medium.com': 'Medium',
        'substack.com': 'Substack',
        'gmail.com': 'Gmail',
        'outlook.com': 'Outlook',
        'yahoo.com': 'Yahoo',
        'bing.com': 'Bing',
        'duckduckgo.com': 'DuckDuckGo',
        'chatgpt.com': 'ChatGPT',
        'openai.com': 'OpenAI',
        'anthropic.com': 'Anthropic',
        'claude.ai': 'Claude',
        'copilot.microsoft.com': 'Copilot',
        'bard.google.com': 'Bard',
        'vercel.com': 'Vercel',
        'netlify.com': 'Netlify',
        'heroku.com': 'Heroku'
    };

    // Main extraction method with 2-tier fallback (simplified, synchronous)
    extractWebsiteName(url) {
        try {
            const hostname = this.normalizeHostname(url);
            if (!hostname) return url;

            // Tier 1: Check curated mapping (instant)
            const curatedName = this.getCuratedName(hostname);
            if (curatedName) return curatedName;

            // Tier 2: Hostname parsing fallback (reliable)
            return this.parseHostnameToName(hostname);

        } catch (error) {
            console.error('[WebsiteNameExtractor] Error extracting name:', error);
            return this.parseHostnameToName(this.normalizeHostname(url)) || url;
        }
    }

    // Normalize URL to hostname
    normalizeHostname(url) {
        try {
            // Handle URLs without protocol
            const normalizedUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
            const urlObj = new URL(normalizedUrl);
            let hostname = urlObj.hostname.toLowerCase();
            
            // Remove www. prefix for consistent mapping
            if (hostname.startsWith('www.')) {
                hostname = hostname.substring(4);
            }
            
            return hostname;
        } catch {
            // Fallback for invalid URLs - extract hostname-like pattern
            const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/);
            return match ? match[1].toLowerCase() : url;
        }
    }

    // Tier 1: Get name from curated mapping
    getCuratedName(hostname) {
        return WebsiteNameExtractor.POPULAR_SITES[hostname] || null;
    }


    // Tier 3: Parse hostname to readable name (fallback)
    parseHostnameToName(hostname) {
        if (!hostname) return null;

        try {
            // Remove common subdomains
            let name = hostname.replace(/^(www|m|mobile|app|api|cdn|static)\./, '');
            
            // Remove TLD for cleaner display
            name = name.replace(/\.(com|org|net|edu|gov|mil|int|co|io|ly|me|tv|app|dev|ai)$/, '');
            
            // Handle special cases
            if (name.includes('.')) {
                // For multi-part domains, use the main part
                const parts = name.split('.');
                name = parts[parts.length - 1]; // Last part before TLD
            }
            
            // Capitalize first letter
            return name.charAt(0).toUpperCase() + name.slice(1);
        } catch {
            return hostname;
        }
    }

}

// Singleton instance for reuse
export const websiteNameExtractor = new WebsiteNameExtractor();