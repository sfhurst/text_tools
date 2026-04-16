// ============================================================
//  GLOBAL ENGINE TOGGLE
// ============================================================
let engineEnabled = true;

function checkToggleSequence(el) {
  const isInput = el.value !== undefined;
  const text = isInput ? el.value : el.innerText;

  if (!text.includes(";;;")) return;

  const newText = text.replace(";;;", "");
  if (isInput) el.value = newText;
  else el.innerText = newText;

  engineEnabled = !engineEnabled;
}

// ============================================================
//  CANONICAL SET FOR SPECIAL-CASE WORDS (e.g., iTAMS)
// ============================================================
const specialCanonicalSet = new Set(
  Object.values(specialCaseWords).map((v) => v.toLowerCase()),
);

// ============================================================
//  SAFE CARET RESOLUTION FOR CONTENTEDITABLE
// ============================================================
function resolveNodeAndOffset(root, index) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
    false,
  );

  let node;
  while ((node = walker.nextNode())) {
    if (index <= node.length) {
      return { node, offset: index };
    }
    index -= node.length;
  }

  const last = root.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    return { node: last, offset: last.length };
  }

  return { node: root, offset: root.innerText.length };
}

function setCaretRange(el, start, end) {
  const range = document.createRange();
  const sel = window.getSelection();

  const startPos = resolveNodeAndOffset(el, start);
  const endPos = resolveNodeAndOffset(el, end);

  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  sel.removeAllRanges();
  sel.addRange(range);
}

// ============================================================
//  INTELLIGENT CAPITALIZATION (live engines)
// ============================================================
function intelligentCapitalize(typedKey, phrase, textBefore) {
  const phraseIsProper =
    phrase[0] === phrase[0].toUpperCase() &&
    phrase.slice(1) !== phrase.slice(1).toUpperCase();
  if (phraseIsProper) return phrase;

  const firstTypedUpper = typedKey[0] === typedKey[0].toUpperCase();

  // ⭐ DO NOT trim away newlines
  const trimmed = textBefore.replace(/[ \t]+$/g, "");

  const endsSentence =
    trimmed.endsWith(".") ||
    trimmed.endsWith("?") ||
    trimmed.endsWith("!") ||
    trimmed.endsWith("\n") ||
    trimmed.length === 0;

  if (firstTypedUpper || endsSentence) {
    return phrase[0].toUpperCase() + phrase.slice(1).toLowerCase();
  }

  return phrase;
}

// ============================================================
//  TEXT REPLACEMENT ENGINE
// ============================================================
function replaceShortcut(el) {
  if (!engineEnabled) return;

  const isInput = el.value !== undefined;
  const text = isInput ? el.value : el.innerText;

  const match = text.match(/(\S+)([ .,:])$/);
  if (!match) return;

  const key = match[1];
  const trigger = match[2];
  const lowerKey = key.toLowerCase();

  if (!shortcuts[lowerKey]) return;

  const phrase = shortcuts[lowerKey];

  const before = text.slice(0, text.length - key.length - 1);
  const finalPhrase = intelligentCapitalize(key, phrase, before);

  const replacement = finalPhrase + trigger;
  const newText = before + replacement;

  if (isInput) {
    el.value = newText;
    el.setSelectionRange(newText.length, newText.length);
  } else {
    el.innerText = newText;
    setCaretRange(el, newText.length, newText.length);
  }
}

// ============================================================
//  PREDICTIVE TEXT ENGINE (suffix-only, never overwrites typed)
// ============================================================
let predictiveActive = false;
let predictiveWasDeleted = false;

function predictiveText(el) {
  if (!engineEnabled) return;

  if (predictiveWasDeleted) {
    predictiveWasDeleted = false;
    return;
  }

  const isInput = el.value !== undefined;
  const text = isInput ? el.value : el.innerText;

  let caretPos = 0;
  if (isInput) {
    caretPos = el.selectionStart;
  } else {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    caretPos = pre.toString().length;
  }

  const before = text.slice(0, caretPos);
  const match = before.match(/([A-Za-z-_]+)$/);
  if (!match) {
    predictiveActive = false;
    return;
  }

  const typed = match[1];
  const wordStart = caretPos - typed.length;

  if (typed.length < 2) {
    predictiveActive = false;
    return;
  }

  const lowerTyped = typed.toLowerCase();

  const candidate = predictiveWords.find((w) =>
    w.toLowerCase().startsWith(lowerTyped),
  );

  if (!candidate || candidate.toLowerCase() === lowerTyped) {
    predictiveActive = false;
    return;
  }

  // SUFFIX-ONLY predictive suggestion
  const full = candidate.toLowerCase();
  const suffix = full.slice(typed.length); // only untyped part

  const after = text.slice(caretPos);
  const afterLetters = after.match(/^[A-Za-z]*/)[0];
  const combined = typed + afterLetters;
  const lowerCombined = combined.toLowerCase();

  const validPrefix = predictiveWords.some((w) =>
    w.toLowerCase().startsWith(lowerCombined),
  );

  if (!validPrefix) {
    predictiveActive = false;
    return;
  }

  const afterWithoutLetters = after.slice(afterLetters.length);

  // KEEP TYPED TEXT EXACTLY AS TYPED
  const newText = text.slice(0, caretPos) + suffix + afterWithoutLetters;

  const selStart = caretPos;
  const selEnd = caretPos + suffix.length;

  if (isInput) {
    el.value = newText;
    el.setSelectionRange(selStart, selEnd);
  } else {
    el.innerText = newText;
    setCaretRange(el, selStart, selEnd);
  }

  predictiveActive = true;
}

// ============================================================
//  ACCEPT PREDICTIVE WORD WITH SEMICOLON
// ============================================================
function handlePredictiveSemicolon(e) {
  if (!engineEnabled) return;
  if (e.key !== ";") return;

  const el = e.target;
  if (!el.isContentEditable && !["INPUT", "TEXTAREA"].includes(el.tagName)) {
    return;
  }

  if (!predictiveActive) return;

  e.preventDefault();

  const isInput = el.value !== undefined;
  const text = isInput ? el.value : el.innerText;

  let caretPos = 0;
  if (isInput) {
    caretPos = el.selectionEnd;
  } else {
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    caretPos = pre.toString().length;
  }

  const before = text.slice(0, caretPos);
  const match = before.match(/([A-Za-z-_]+)$/);
  if (!match) return;

  const typed = match[1];
  const wordStart = caretPos - typed.length;

  const candidate = predictiveWords.find((w) =>
    w.toLowerCase().startsWith(typed.toLowerCase()),
  );
  if (!candidate) return;

  const beforeWord = text.slice(0, wordStart);
  const finalWord = intelligentCapitalize(typed, candidate, beforeWord);

  const after = text.slice(caretPos);
  const newText = beforeWord + finalWord + after;

  if (isInput) {
    el.value = newText;
    const pos = wordStart + finalWord.length;
    el.setSelectionRange(pos, pos);
  } else {
    el.innerText = newText;
    const pos = wordStart + finalWord.length;
    setCaretRange(el, pos, pos);
  }

  predictiveActive = false;
}

// ============================================================
//  3RD ENGINE: CLEANUP ON ";l;"
//  ORDER:
//    1) spellFixes
//    2) whitespace cleanup
//    3) sentence capitalization
//    4) properNouns
//    5) specialCaseWords
// ============================================================
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applySpellFixes(text) {
  let result = text;

  for (const [key, value] of Object.entries(spellFixes)) {
    const pattern = "\\b" + escapeRegExp(key) + "\\b";
    const regex = new RegExp(pattern, "gi");
    result = result.replace(regex, value);
  }

  return result;
}

function applyWhitespaceCleanup(text) {
  let result = text.replace(/ {2,}/g, " ");
  result = result
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return result;
}

function applySentenceCapitalization(text) {
  return text.replace(
    /(^|[.!?\n]\s+)([A-Za-z][^\s]*)/g,
    (match, prefix, word) => {
      const lowerWord = word.toLowerCase();
      if (specialCanonicalSet.has(lowerWord)) {
        // Respect canonical special-case forms (e.g., iTAMS)
        return prefix + word;
      }
      return prefix + word[0].toUpperCase() + word.slice(1);
    },
  );
}

function applyProperNouns(text) {
  let result = text;

  for (const [key, value] of Object.entries(properNouns)) {
    const pattern = "\\b" + escapeRegExp(key) + "\\b";
    const regex = new RegExp(pattern, "gi");
    result = result.replace(regex, value);
  }

  return result;
}

function applySpecialCaseWords(text) {
  let result = text;

  for (const [key, value] of Object.entries(specialCaseWords)) {
    const pattern = "\\b" + escapeRegExp(key) + "\\b";
    const regex = new RegExp(pattern, "gi");
    result = result.replace(regex, value);
  }

  return result;
}

function runCleanupEngine(el) {
  const isInput = el.value !== undefined;
  const originalText = isInput ? el.value : el.innerText;

  // 1) Remove the trigger ";l;" (all occurrences)
  let text = originalText.replace(/;l;/g, "");

  // 2) Spell fixes
  text = applySpellFixes(text);

  // 3) Whitespace cleanup
  text = applyWhitespaceCleanup(text);

  // 4) Sentence capitalization (respecting special-case canonical forms)
  text = applySentenceCapitalization(text);

  // 5) Proper nouns
  text = applyProperNouns(text);

  // 6) Special-case words (final authority)
  text = applySpecialCaseWords(text);

  // 7) Write back and move caret to end
  if (isInput) {
    el.value = text;
    el.setSelectionRange(text.length, text.length);
  } else {
    el.innerText = text;
    setCaretRange(el, text.length, text.length);
  }
}

function checkCleanupSequence(el) {
  const isInput = el.value !== undefined;
  const text = isInput ? el.value : el.innerText;

  if (!text.includes(";l;")) return;

  runCleanupEngine(el);
}

// ============================================================
//  BACKSPACE + DELETE HANDLER (your original logic, preserved)
// ============================================================
document.addEventListener("keydown", (e) => {
  if (!engineEnabled) return;

  if (e.key === "Delete" && predictiveActive) {
    const el = e.target;
    const isInput = el.value !== undefined;

    let start, end;
    if (isInput) {
      start = el.selectionStart;
      end = el.selectionEnd;
    } else {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);

      const preStart = range.cloneRange();
      preStart.selectNodeContents(el);
      preStart.setEnd(range.startContainer, range.startOffset);
      start = preStart.toString().length;

      const preEnd = range.cloneRange();
      preEnd.selectNodeContents(el);
      preEnd.setEnd(range.endContainer, range.endOffset);
      end = preEnd.toString().length;
    }

    if (start < end) {
      predictiveActive = false;
      predictiveWasDeleted = true;
    }
  }

  if (e.key !== "Backspace") return;

  const el = e.target;
  if (!predictiveActive) return;

  const isInput = el.value !== undefined;
  const text = isInput ? el.value : el.innerText;

  let start, end;
  if (isInput) {
    start = el.selectionStart;
    end = el.selectionEnd;
  } else {
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);

    const preStart = range.cloneRange();
    preStart.selectNodeContents(el);
    preStart.setEnd(range.startContainer, range.startOffset);
    start = preStart.toString().length;

    const preEnd = range.cloneRange();
    preEnd.selectNodeContents(el);
    preEnd.setEnd(range.endContainer, range.endOffset);
    end = preEnd.toString().length;
  }

  if (start < end) {
    e.preventDefault();

    const newStart = Math.max(start - 1, 0);

    const beforeTyped = text.slice(0, newStart);
    const typedMatch = beforeTyped.match(/([A-Za-z]+)$/);
    const typedPortion = typedMatch ? typedMatch[1] : "";

    if (typedPortion.length < 2) {
      predictiveActive = false;

      const newText = text.slice(0, newStart) + text.slice(end);
      if (isInput) el.value = newText;
      else el.innerText = newText;

      if (isInput) {
        el.setSelectionRange(newStart, newStart);
      } else {
        setCaretRange(el, newStart, newStart);
      }

      return;
    }

    if (isInput) {
      el.setSelectionRange(newStart, end);
    } else {
      setCaretRange(el, newStart, end);
    }

    return;
  }

  const beforeWord = text.slice(0, start);
  const currentWordMatch = beforeWord.match(/([A-Za-z]+)$/);
  const currentWord = currentWordMatch ? currentWordMatch[1] : "";

  const word = predictiveWords.find(
    (w) => currentWord.toLowerCase() === w.toLowerCase(),
  );

  if (word) {
    e.preventDefault();

    const newStart = start - 1;
    const newEnd = start;

    const beforeTyped = text.slice(0, newStart);
    const typedMatch = beforeTyped.match(/([A-Za-z]+)$/);
    const typedPortion = typedMatch ? typedMatch[1] : "";

    if (typedPortion.length < 2) {
      predictiveActive = false;

      const newText = text.slice(0, newStart) + text.slice(end);
      if (isInput) el.value = newText;
      else el.innerText = newText;

      if (isInput) {
        el.setSelectionRange(newStart, newStart);
      } else {
        setCaretRange(el, newStart, newStart);
      }

      return;
    }

    if (isInput) {
      el.setSelectionRange(newStart, newEnd);
    } else {
      setCaretRange(el, newStart, newEnd);
    }

    return;
  }
});

// ============================================================
//  INPUT + KEYDOWN LISTENERS
// ============================================================
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.isContentEditable && !["INPUT", "TEXTAREA"].includes(el.tagName)) {
    return;
  }

  checkToggleSequence(el);
  if (!engineEnabled) return;

  const isCKE = el.closest(".ck-editor__editable") !== null;

  if (isCKE) {
    // CKEditor-safe: defer engine work to next animation frame
    requestAnimationFrame(() => {
      checkCleanupSequence(el);
      predictiveText(el);
      replaceShortcut(el);
    });
  } else {
    // Normal immediate timing
    checkCleanupSequence(el);
    predictiveText(el);
    replaceShortcut(el);
  }
});

document.addEventListener("keydown", handlePredictiveSemicolon);
