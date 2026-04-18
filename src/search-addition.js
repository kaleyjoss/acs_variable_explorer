// search javascript to add to claude code outputs
// Search: match id, detailLabel, label, baseVar
  const searchResults = useMemo(() => {
    if (!search) return [];

    // 1. Split by space. 
    // Using /\s+/ handles accidental double spaces, and .filter(Boolean) removes empty strings.
    const arrayOfStrings = search.toLowerCase().split(/\s+/).filter(Boolean);
    const seenLabels = new Set();

    return rows.filter(r => {
        // Cache the lowercased label so we don't recalculate it for every single word
        const rowLabel = r.label.toLowerCase();

        // 2. .every() checks if EVERY word in the array is found in the label
        const matchesAllWords = arrayOfStrings.every(word => rowLabel.includes(word));
        
        // If it doesn't match all words, discard the row
        if (!matchesAllWords) return false; 

        // 3. Check if we already have a row with this exact label
        if (seenLabels.has(r.label)) return false; 

        // 4. Mark label as seen and keep the row
        seenLabels.add(r.label); 
        return true;

    }).slice(0, 60);
  }, [rows, search]);