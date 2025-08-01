/**
 * Scoring Constants - Centralized scoring system for all spotlight results
 * 
 * Purpose: Defines the base scoring hierarchy for all result types in the spotlight system
 * Key Functions: Provides consistent scoring across all data providers and result types
 * Architecture: Simple constants export with clear hierarchy documentation
 * 
 * Critical Notes:
 * - Higher scores appear first in search results
 * - Instant suggestions always get the highest priority (1000)
 * - User content (bookmarks, history) prioritized over external suggestions
 * - Fuzzy matches positioned strategically between history and top sites
 */

// Base scores for each result type (higher = appears first)
export const BASE_SCORES = {
    // Instant suggestions (always first)
    INSTANT_SEARCH_QUERY: 1000,
    INSTANT_URL_SUGGESTION: 1000,
    
    // Regular search results hierarchy
    SEARCH_QUERY: 100,
    URL_SUGGESTION: 95,
    OPEN_TAB: 90,
    PINNED_TAB: 85,  // Pinned tabs ranked between open tabs and bookmarks
    BOOKMARK: 80,
    HISTORY: 70,
    TOP_SITE: 60,
    
    // Top site Fuzzy match scores (positioned above autocomplete, between history and top sites)
    FUZZY_MATCH_START: 65,      // Exact start matches (e.g., "squaresp" → "squarespace.com")
    FUZZY_MATCH_CONTAINS: 63,   // Contains matches (e.g., "space" → "squarespace.com")
    FUZZY_MATCH_NAME: 62,       // Display name matches (e.g., "square" → "Squarespace")
    FUZZY_MATCH_DEFAULT: 60,    // Default fuzzy match score


    AUTOCOMPLETE_SUGGESTION: 30    // Moved below fuzzy matches
};

// Score bonuses for relevance matching
export const SCORE_BONUSES = {
    EXACT_TITLE_MATCH: 20,      // Title exactly matches query
    TITLE_STARTS_WITH: 15,      // Title starts with query
    TITLE_CONTAINS: 10,         // Title contains query
    URL_CONTAINS: 5             // URL contains query
};

// Autocomplete score calculation (decreasing by position)
export const getAutocompleteScore = (index) => {
    return BASE_SCORES.AUTOCOMPLETE_SUGGESTION - index;
};

// Fuzzy match score calculation with domain length penalty
export const getFuzzyMatchScore = (matchType, domainLength = 0, queryLength = 0) => {
    let score = BASE_SCORES.FUZZY_MATCH_DEFAULT;
    
    switch (matchType) {
        case 'start':
            // Prefer shorter domains for start matches
            score = BASE_SCORES.FUZZY_MATCH_START - (domainLength - queryLength) * 0.1;
            break;
        case 'contains':
            score = BASE_SCORES.FUZZY_MATCH_CONTAINS;
            break;
        case 'name':
            score = BASE_SCORES.FUZZY_MATCH_NAME;
            break;
        default:
            score = BASE_SCORES.FUZZY_MATCH_DEFAULT;
    }
    
    return Math.max(score, BASE_SCORES.FUZZY_MATCH_NAME); // Ensure minimum score
};