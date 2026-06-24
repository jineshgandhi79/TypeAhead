import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:5000';

function App() {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const [message, setMessage] = useState('');

  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  // Debounced prefix suggestion fetching
  useEffect(() => {
    const trimmedInput = input.trim();
    setSelectedIndex(-1);

    if (!trimmedInput) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const delayDebounce = setTimeout(() => {
      fetchSuggestions(trimmedInput);
    }, 300); // 300ms debounce delay

    return () => clearTimeout(delayDebounce);
  }, [input]);

  // Fetch suggestions helper
  const fetchSuggestions = async (prefix) => {
    try {
      const res = await fetch(`${API_BASE}/suggest?q=${encodeURIComponent(prefix)}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data);
        setShowDropdown(data.length > 0);
      }
    } catch (err) {
      console.error('Error fetching suggestions:', err);
    }
  };

  // Submit search query
  const submitSearch = async (queryText) => {
    const textToSubmit = queryText || input;
    if (!textToSubmit.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: textToSubmit }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessage(`Success: ${data.message || 'Searched'} "${textToSubmit}"!`);
        setTimeout(() => setMessage(''), 4000);
      }
    } catch (err) {
      console.error('Search submission failed:', err);
    }

    setShowDropdown(false);
  };

  // Click handler for suggestions
  const handleSuggestionClick = (queryText) => {
    setInput(queryText);
    submitSearch(queryText);
  };

  // Keyboard navigation handler
  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        const selectedQuery = suggestions[selectedIndex].query;
        setInput(selectedQuery);
        submitSearch(selectedQuery);
      } else {
        submitSearch(input);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(e.target) &&
        inputRef.current && 
        !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div className="minimal-search-container">
      <div className="minimal-search-box-wrapper">
        <div className="input-container">
          <span className="search-icon-left">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Type to search..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => {
              if (suggestions.length > 0) setShowDropdown(true);
            }}
            onKeyDown={handleKeyDown}
          />
          {input && (
            <button 
              className="clear-btn" 
              onClick={() => { setInput(''); setSuggestions([]); }}
            >
              ✕
            </button>
          )}

          {/* Dropdown Suggestions */}
          {showDropdown && suggestions.length > 0 && (
            <div className="suggestions-dropdown" ref={dropdownRef}>
              {suggestions.map((item, index) => (
                <div
                  key={item.query}
                  className={`suggestion-item ${selectedIndex === index ? 'active' : ''}`}
                  onClick={() => handleSuggestionClick(item.query)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="suggestion-text">{item.query}</span>
                  <div className="suggestion-stats">
                    <span className="tag-count">count: {item.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button 
          className="search-submit-btn" 
          onClick={() => submitSearch()}
        >
          Search
        </button>
      </div>

      {/* Response Message Toast */}
      {message && (
        <div className="search-response-toast">
          <span>✓</span> {message}
        </div>
      )}
    </div>
  );
}

export default App;
