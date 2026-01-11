// DOM Elements
const views = {
    loading: document.getElementById('loading-view'),
    list: document.getElementById('list-view'),
    flashCard: document.getElementById('flash-card-view'),
    quiz: document.getElementById('quiz-view'),
    listening: document.getElementById('listening-view'),
    writing: document.getElementById('writing-view'),
    settings: document.getElementById('settings-view')
};

const navItems = document.querySelectorAll('.nav-item');
const settingsBtn = document.getElementById('settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const themeBtns = document.querySelectorAll('.theme-btn');


const wordListEl = document.getElementById('word-list');
const wordSearchInput = document.getElementById('word-search');

// Quiz Elements
const quizQuestionWord = document.getElementById('question-word');
const quizQuestionPos = document.getElementById('question-pos');
const quizOptionsEl = document.getElementById('quiz-options');
const quizProgressCurrent = document.getElementById('q-current');
const quizProgressTotal = document.getElementById('q-total');
const currentScoreEl = document.getElementById('current-score');
const quizFeedback = document.getElementById('quiz-feedback');
const feedbackText = document.getElementById('feedback-text');
const nextQBtn = document.getElementById('next-q-btn');
// Flash Card Elements
const fcCloseBtn = document.getElementById('fc-close-btn');
const fcProgress = document.getElementById('fc-progress');
const fcCard = document.getElementById('flash-card');
const fcWord = document.getElementById('fc-word');
const fcAudioBtn = document.getElementById('fc-audio-btn');
const fcMeaning = document.getElementById('fc-meaning');
const fcExample = document.getElementById('fc-example');
const fcExampleJa = document.getElementById('fc-example-ja');


// State
let allWords = [];

let currentTheme = localStorage.getItem('theme') || 'nebula';
let currentQuiz = {
    score: 0,
    currentQuestionIndex: 0,
    questions: [],
    isAnswered: false
};
let currentGroupIndex = null;

// Flash Card State
let fcList = [];
let fcCurrentIndex = 0;
let fcIsFlipped = false;
// Swipe State
let touchStartX = 0;
let touchEndX = 0;
let isSwiping = false;


// Mock Data (Fallback)
// Mock Data (Fallback)
const MOCK_WORDS = [
    { word: 'Abandon', meaning: '放棄する', pos: 'verb', example: 'He abandoned his car in the snow.', example_ja: '彼は雪の中に車を乗り捨てた。' },
    { word: 'Abstract', meaning: '抽象的な', pos: 'adj', example: 'The concept is too abstract.', example_ja: 'その概念はあまりにも抽象的すぎる。' },
    { word: 'Accumulate', meaning: '蓄積する', pos: 'verb', example: 'Evidence began to accumulate.', example_ja: '証拠が蓄積し始めた。' },
    { word: 'Bias', meaning: '偏見', pos: 'noun', example: 'The article has a clear bias.', example_ja: 'その記事には明らかな偏見がある。' },
    { word: 'Capable', meaning: '能力がある', pos: 'adj', example: 'She is capable of running the company.', example_ja: '彼女には会社を経営する能力がある。' },
    { word: 'Debate', meaning: '討論', pos: 'noun', example: 'The debate lasted for hours.', example_ja: '討論は数時間続いた。' },
    { word: 'Efficient', meaning: '効率的な', pos: 'adj', example: 'This is an efficient method.', example_ja: 'これは効率的な方法だ。' },
    { word: 'Fluctuate', meaning: '変動する', pos: 'verb', example: 'Prices fluctuate wildly.', example_ja: '価格は激しく変動する。' },
    { word: 'Genre', meaning: 'ジャンル', pos: 'noun', example: 'What genre of music do you like?', example_ja: 'どんなジャンルの音楽が好きですか？' },
    { word: 'Hypothesis', meaning: '仮説', pos: 'noun', example: 'We tested the hypothesis.', example_ja: '我々は仮説を検証した。' }
];

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme);
    fetchWords();
    setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
    // Navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.dataset.target;
            if (target === 'list-view') {
                currentGroupIndex = null; // Reset to list groups
                renderWordList();
            }
            switchView(target);
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            if (target === 'quiz-view') {
                startNewQuiz();
            }
        });
    });

    // Settings
    // Settings
    const closeSettings = () => {
        // Return to last active view or list
        switchView('list-view');
        // Reset nav
        navItems.forEach(n => n.classList.remove('active'));
        document.querySelector('[data-target="list-view"]').classList.add('active');
    };

    settingsBtn.addEventListener('click', () => {
        if (views.settings.classList.contains('active')) {
            closeSettings();
        } else {
            switchView('settings-view');
        }
    });

    closeSettingsBtn.addEventListener('click', closeSettings);

    // --- Listening Mode Logic ---
    const listeningInputContainer = document.getElementById('listening-input-container');
    const listeningPlayerContainer = document.getElementById('listening-player-container');
    const listeningTextInput = document.getElementById('listening-text-input');
    const listeningStartBtn = document.getElementById('listening-start-btn');
    const listeningBackBtn = document.getElementById('listening-back-btn');
    const listeningTextDisplay = document.getElementById('listening-text-display');
    const listeningBlindOverlay = document.getElementById('listening-blind-overlay');
    const listeningVoiceLabel = document.getElementById('listening-voice-label');

    // Player Controls
    const listeningRwBtn = document.getElementById('listening-rw-btn'); // -5s
    const listeningPlayBtn = document.getElementById('listening-play-btn');
    const listeningFfBtn = document.getElementById('listening-ff-btn'); // +5s
    const listeningLoopBtn = document.getElementById('listening-loop-btn'); // Loop
    const listeningBlindBtn = document.getElementById('listening-blind-btn'); // Blind

    let listeningText = '';
    let listeningUtterance = null;
    let listeningIsPaused = false;
    let listeningCharIndices = []; // Maps DOM index to char index
    let listeningCurrentCharIndex = 0;
    let listeningLoopEnabled = false; // Loop state
    let listeningBlindEnabled = false; // Blind mode state

    // Time-based tracking for PC compatibility
    let listeningStartTime = 0;
    let listeningPausedAt = 0; // Character index where we paused
    let listeningHighlightInterval = null;

    // Setup Listening Mode
    function initListeningMode() {
        // Update voice label - Removed as element doesn't exist
        // const voice = voices.find(v => v.voiceURI === currentVoiceURI);
        // if (voice && listeningVoiceLabel) {
        //     listeningVoiceLabel.textContent = voice.name;
        // }

        // Prepare UI
        listeningInputContainer.classList.remove('hidden');
        listeningPlayerContainer.classList.add('hidden');
        listeningTextInput.value = '';
    }

    // Start Button
    listeningStartBtn.addEventListener('click', () => {
        console.log('Start Listening clicked');
        let text = listeningTextInput.value.trim();
        if (!text) {
            text = listeningTextInput.placeholder;
        }

        if (!text) {
            alert('Please enter some text or ensure placeholder text is available.');
            return;
        }
        startListeningSession(text);
    });

    // Back to Input
    listeningBackBtn.addEventListener('click', () => {
        stopListening();
        listeningPlayerContainer.classList.add('hidden');
        listeningInputContainer.classList.remove('hidden');
    });

    // Start Session
    function startListeningSession(text) {
        listeningText = text;
        listeningInputContainer.classList.add('hidden');
        listeningPlayerContainer.classList.remove('hidden');

        renderListeningText(text);
        listeningCurrentCharIndex = 0;
        playListeningAudio(0);
    }

    // Render Text with Spans
    function renderListeningText(text) {
        listeningTextDisplay.innerHTML = '';
        listeningCharIndices = [];

        // Split by spaces but preserve them in logic if needed, simplify for now:
        // We will wrap words in <span>. 
        // A simple regex approach to find words and their indices:
        const regex = /\S+/g;
        let match;
        let lastIndex = 0;

        // Helper to append non-word text
        const appendText = (str) => {
            if (str) {
                listeningTextDisplay.appendChild(document.createTextNode(str));
            }
        };

        while ((match = regex.exec(text)) !== null) {
            // Append preceding whitespace/punctuation
            appendText(text.substring(lastIndex, match.index));

            // Create span for word
            const span = document.createElement('span');
            span.textContent = match[0];
            span.dataset.start = match.index;
            span.dataset.end = match.index + match[0].length;

            // Click/Touch to seek - capture the index in closure
            const wordStartIndex = match.index;
            let lastSeekTime = 0;

            const handleSeek = () => {
                // Prevent double-firing (debounce)
                const now = Date.now();
                if (now - lastSeekTime < 300) return;
                lastSeekTime = now;

                listeningPausedAt = wordStartIndex;
                playListeningAudio(wordStartIndex);
            };

            // Use click only - works on both desktop and mobile
            span.addEventListener('click', handleSeek);

            listeningTextDisplay.appendChild(span);
            listeningCharIndices.push({
                start: match.index,
                end: match.index + match[0].length,
                element: span
            });

            lastIndex = match.index + match[0].length;
        }
        // Append remaining text
        appendText(text.substring(lastIndex));
    }

    // Play Audio
    function playListeningAudio(startIndex) {
        // Clear any existing interval
        if (listeningHighlightInterval) {
            clearInterval(listeningHighlightInterval);
            listeningHighlightInterval = null;
        }

        window.speechSynthesis.cancel();
        listeningIsPaused = false;
        listeningCurrentCharIndex = startIndex;
        updatePlayIcon(true);

        // Immediately highlight the starting word
        highlightWord(startIndex);

        const textToSpeak = listeningText.substring(startIndex);
        if (!textToSpeak) {
            updatePlayIcon(false);
            return;
        }

        listeningUtterance = new SpeechSynthesisUtterance(textToSpeak);

        // Apply voice settings
        const voice = voices.find(v => v.voiceURI === currentVoiceURI);
        if (voice) listeningUtterance.voice = voice;
        listeningUtterance.rate = 1.0;

        // Adaptive tracking variables
        let lastBoundaryTime = Date.now();
        let lastBoundaryCharIndex = startIndex;
        let adaptiveCharsPerSecond = 12; // Conservative initial estimate
        let boundaryEventReceived = false;

        // Timer-based highlighting (only used when no boundary events)
        listeningHighlightInterval = setInterval(() => {
            if (listeningIsPaused) return;

            // Only use timer-based estimation if no boundary events are being received
            if (!boundaryEventReceived) {
                const elapsed = (Date.now() - lastBoundaryTime) / 1000;
                const estimatedCharIndex = lastBoundaryCharIndex + Math.floor(elapsed * adaptiveCharsPerSecond);

                if (estimatedCharIndex < listeningText.length && estimatedCharIndex > listeningCurrentCharIndex) {
                    listeningCurrentCharIndex = estimatedCharIndex;
                    highlightWord(estimatedCharIndex);
                }
            }
        }, 150);

        // Boundary Event (Progress Tracking) - primary source of truth
        listeningUtterance.onboundary = (event) => {
            if (event.name === 'word') {
                boundaryEventReceived = true;
                const globalCharIndex = startIndex + event.charIndex;

                // Calculate actual speed from this boundary event
                const timeSinceLastBoundary = (Date.now() - lastBoundaryTime) / 1000;
                const charsSinceLastBoundary = globalCharIndex - lastBoundaryCharIndex;

                if (timeSinceLastBoundary > 0.05 && charsSinceLastBoundary > 0) {
                    // Update adaptive speed (moving average)
                    const measuredSpeed = charsSinceLastBoundary / timeSinceLastBoundary;
                    adaptiveCharsPerSecond = adaptiveCharsPerSecond * 0.7 + measuredSpeed * 0.3;
                }

                // Update tracking variables
                lastBoundaryTime = Date.now();
                lastBoundaryCharIndex = globalCharIndex;
                listeningCurrentCharIndex = globalCharIndex;

                highlightWord(globalCharIndex);

                // Reset flag after a short delay to detect gaps
                setTimeout(() => { boundaryEventReceived = false; }, 200);
            }
        };

        listeningUtterance.onend = () => {
            if (listeningHighlightInterval) {
                clearInterval(listeningHighlightInterval);
                listeningHighlightInterval = null;
            }

            // If loop is enabled, restart from beginning
            if (listeningLoopEnabled) {
                listeningCurrentCharIndex = 0;
                listeningPausedAt = 0;
                playListeningAudio(0);
                return;
            }

            listeningIsPaused = false;
            updatePlayIcon(false);
            clearHighlights();
        };

        listeningUtterance.onerror = () => {
            if (listeningHighlightInterval) {
                clearInterval(listeningHighlightInterval);
                listeningHighlightInterval = null;
            }
            updatePlayIcon(false);
        };

        window.speechSynthesis.speak(listeningUtterance);
    }

    // Controls
    listeningPlayBtn.onclick = () => {
        if (listeningIsPaused) {
            // Resume from saved position
            playListeningAudio(listeningPausedAt);
        } else if (window.speechSynthesis.speaking) {
            // Pause - save current position
            listeningPausedAt = listeningCurrentCharIndex;
            window.speechSynthesis.cancel(); // Use cancel instead of pause for reliability
            if (listeningHighlightInterval) {
                clearInterval(listeningHighlightInterval);
                listeningHighlightInterval = null;
            }
            listeningIsPaused = true;
            updatePlayIcon(false);
        } else {
            // Start/Restart if not playing
            playListeningAudio(listeningCurrentCharIndex || 0);
        }
    };

    // Skip -5s / +5s (Approx 15 chars per sec -> 75 chars)
    const SKIP_CHARS = 75;

    listeningRwBtn.onclick = () => {
        let newIndex = Math.max(0, listeningCurrentCharIndex - SKIP_CHARS);
        listeningPausedAt = newIndex;
        playListeningAudio(newIndex);
    };

    listeningFfBtn.onclick = () => {
        let newIndex = Math.min(listeningText.length - 1, listeningCurrentCharIndex + SKIP_CHARS);
        listeningPausedAt = newIndex;
        playListeningAudio(newIndex);
    };

    // Loop button toggle
    listeningLoopBtn.onclick = () => {
        listeningLoopEnabled = !listeningLoopEnabled;
        listeningLoopBtn.classList.toggle('active', listeningLoopEnabled);
    };

    // Blind button toggle
    listeningBlindBtn.onclick = () => {
        listeningBlindEnabled = !listeningBlindEnabled;
        listeningBlindBtn.classList.toggle('active', listeningBlindEnabled);
        listeningTextDisplay.classList.toggle('blinded', listeningBlindEnabled);

        // Toggle icon
        const icon = listeningBlindBtn.querySelector('ion-icon');
        icon.name = listeningBlindEnabled ? 'eye-off-outline' : 'eye-outline';

        // Toggle overlay visibility
        listeningBlindOverlay.classList.toggle('hidden', !listeningBlindEnabled);
    };

    function stopListening() {
        if (listeningHighlightInterval) {
            clearInterval(listeningHighlightInterval);
            listeningHighlightInterval = null;
        }
        window.speechSynthesis.cancel();
    }

    // UI Helpers
    function updatePlayIcon(isPlaying) {
        listeningPlayBtn.innerHTML = isPlaying ?
            '<ion-icon name="pause"></ion-icon>' :
            '<ion-icon name="play"></ion-icon>';
    }

    function highlightWord(charIndex) {
        // Find the span that contains this charIndex
        const match = listeningCharIndices.find(item =>
            charIndex >= item.start && charIndex < item.end
        );

        if (match) {
            clearHighlights();
            match.element.classList.add('active');
            match.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function clearHighlights() {
        const active = listeningTextDisplay.querySelector('.active');
        if (active) active.classList.remove('active');
    }

    // Theme Switching
    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            applyTheme(theme);
        });
    });



    // Search & Filter
    wordSearchInput.addEventListener('input', renderWordList);

    // Quiz (Disabled)
    // nextQBtn.addEventListener('click', nextQuestion);

    // Flash Cards
    fcCloseBtn.addEventListener('click', () => switchView('list-view'));
    fcCard.addEventListener('click', () => {
        if (!isSwiping) flipCard();
    });


    // Swipe Listeners
    fcCard.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        isSwiping = false; // Reset
    }, { passive: true });

    fcCard.addEventListener('touchmove', () => {
        isSwiping = true; // Any move counts as potential swipe, refined in touchend
    }, { passive: true });

    fcCard.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    // Audio button in card (prevent flip)
    fcAudioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = fcList[fcCurrentIndex].word;
        speakWord(word);
    });

    // Example Audio button (prevent flip)
    const fcExampleAudioBtn = document.getElementById('fc-example-audio-btn');
    fcExampleAudioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const example = fcList[fcCurrentIndex].example;
        speakWord(example);
    });

    // Initialize Voices
    populateVoiceList();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoiceList;
    }
}

// Data Handling
async function fetchWords() {
    switchView('loading-view');

    let gasUrl = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) {
        gasUrl = CONFIG.GAS_URL;
    }

    if (gasUrl) {
        try {
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s

            const response = await fetch(gasUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            if (data && data.length > 0) {
                allWords = data;
            } else {
                console.warn('Empty data from GAS, using mock.');
                allWords = MOCK_WORDS;
            }
        } catch (error) {
            console.error('Error fetching GAS:', error);
            if (error.name === 'AbortError') {
                alert('Connection timed out. Using offline data.');
            } else {
                alert('Failed to load data. Please check your URL. Using offline data.');
            }
            allWords = MOCK_WORDS;
        }
    } else {
        console.log('No GAS URL, using mock data.');
        allWords = MOCK_WORDS;
    }

    renderWordList();

    // Only switch if still loading (user might have opened settings)
    if (document.getElementById('loading-view').classList.contains('active')) {
        switchView('list-view');
    }
}

// View Management
function switchView(viewId) {
    // Dynamically select all views to ensure we catch everything
    const allViews = document.querySelectorAll('.view');
    allViews.forEach(el => el.classList.remove('active'));

    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    } else {
        console.error(`View not found: ${viewId}`);
    }



    // Update Nav Icons
    navItems.forEach(n => {
        if (n.dataset.target === viewId) {
            n.classList.add('active');
        } else {
            n.classList.remove('active');
        }
    });

    if (viewId === 'listening-view') {
        initListeningMode();
    }
}

// Word List Logic
function renderWordList() {
    const searchTerm = wordSearchInput.value.toLowerCase();
    wordListEl.innerHTML = '';

    // Filter by Type first
    let candidates = allWords;

    // If searching, show all matching results (ignores groups)
    if (searchTerm) {
        const results = candidates.filter(item =>
            item.word.toLowerCase().includes(searchTerm) ||
            item.meaning.includes(searchTerm)
        );
        if (results.length === 0) {
            wordListEl.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:2rem;">No matches found</p>';
        } else {
            renderWords(results);
        }
        return;
    }

    // Grouping Logic
    if (currentGroupIndex === null) {
        renderGroups(candidates);
    } else {
        const groupSize = 100;
        const start = currentGroupIndex * groupSize;
        const end = Math.min(start + groupSize, candidates.length);

        // Validation (in case filter changed and index is invalid)
        if (start >= candidates.length && candidates.length > 0) {
            currentGroupIndex = 0;
            renderWordList();
            return;
        }

        const pageWords = candidates.slice(start, end);

        // Back Button
        const headerDiv = document.createElement('div');
        headerDiv.className = 'list-header-actions';

        const backBtn = document.createElement('button');
        backBtn.className = 'back-btn';
        backBtn.innerHTML = '<ion-icon name="arrow-back-outline"></ion-icon> Back to Vocab';
        backBtn.onclick = () => {
            currentGroupIndex = null;
            renderWordList();
        };

        const fcStartBtn = document.createElement('button');
        fcStartBtn.className = 'primary-btn small';
        fcStartBtn.innerHTML = '<ion-icon name="shuffle-outline"></ion-icon> Start Random';
        fcStartBtn.onclick = () => {
            const shuffled = [...pageWords].sort(() => 0.5 - Math.random());
            startFlashCards(shuffled);
        };

        headerDiv.appendChild(backBtn);
        headerDiv.appendChild(fcStartBtn);
        wordListEl.appendChild(headerDiv);

        renderWords(pageWords);
    }
}

function renderGroups(words) {
    const groupSize = 100;
    const totalGroups = Math.ceil(words.length / groupSize);

    if (totalGroups === 0) {
        wordListEl.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:2rem;">No words available</p>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'group-grid';

    for (let i = 0; i < totalGroups; i++) {
        const start = i * groupSize + 1;
        const end = Math.min((i + 1) * groupSize, words.length);

        const btn = document.createElement('div');
        btn.className = 'group-btn';
        btn.innerHTML = `
            <span>Vocab ${i + 1}</span>
            <small>${start} - ${end}</small>
        `;

        // Add Button to enter Flash Card Mode directly from here if needed
        // But per request, it's inside the list view

        btn.onclick = () => {
            currentGroupIndex = i;
            renderWordList();
        };
        grid.appendChild(btn);
    }

    wordListEl.appendChild(grid);
}

// Flash Card Logic
function startFlashCards(list, startIndex = 0) {
    if (!list || list.length === 0) return;
    fcList = list;
    fcCurrentIndex = startIndex;
    fcIsFlipped = false;

    switchView('flash-card-view');
    renderCard();
}

function renderCard() {
    const item = fcList[fcCurrentIndex];

    // Temporarily disable transition to prevent seeing the new back content
    fcCard.style.transition = 'none';
    fcCard.classList.remove('flipped');
    fcIsFlipped = false;

    // Force reflow to apply the class removal instantly
    void fcCard.offsetWidth;

    // Restore transition after a brief delay
    setTimeout(() => {
        fcCard.style.transition = '';
    }, 50);

    // Front
    fcWord.textContent = item.word;

    // Back
    fcMeaning.innerHTML = `<span class="pos">${item.pos}</span> ${item.meaning}`;
    fcExample.textContent = item.example;
    fcExampleJa.textContent = item.example_ja || '';

    // Progress
    fcProgress.textContent = `${fcCurrentIndex + 1} / ${fcList.length}`;
}

function flipCard() {
    fcIsFlipped = !fcIsFlipped;
    if (fcIsFlipped) {
        fcCard.classList.add('flipped');
    } else {
        fcCard.classList.remove('flipped');
    }
}

function nextCard() {
    if (fcCurrentIndex < fcList.length - 1) {
        fcCurrentIndex++;
        renderCard();
    }
}

function prevCard() {
    if (fcCurrentIndex > 0) {
        fcCurrentIndex--;
        renderCard();
    }
}

function handleSwipe() {
    const threshold = 50; // Minimum distance for swipe
    const distance = touchStartX - touchEndX;

    if (Math.abs(distance) > threshold) {
        isSwiping = true; // Confirm it was a swipe interaction
        if (distance > 0) {
            // Swipe Left -> Next
            nextCard();
        } else {
            // Swipe Right -> Prev
            prevCard();
        }
    } else {
        isSwiping = false; // Treated as tap
    }
}


function renderWords(words) {
    words.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'word-item';
        div.innerHTML = `
            <div class="word-header">
                <div class="word-title">
                    <span class="word-index">${index + 1}.</span>
                    <span class="word">${item.word}</span>
                    <span class="pos">${item.pos}</span>
                    <button class="audio-btn" aria-label="Listen">
                        <ion-icon name="volume-medium-outline"></ion-icon>
                    </button>
                </div>
            </div>
            <div class="meaning">${item.meaning}</div>
            <div class="example">"${item.example}"</div>
            ${item.example_ja ? `<div class="example-ja">${item.example_ja}</div>` : ''}
        `;

        // Add click listener for audio
        const audioBtn = div.querySelector('.audio-btn');
        audioBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering other clicks if any
            speakWord(item.word);
        });

        // Add click listener for row to start flashcards
        div.addEventListener('click', () => {
            startFlashCards(words, index);
        });

        wordListEl.appendChild(div);
    });
}

// Voice Settings
let currentVoiceURI = localStorage.getItem('voiceURI') || null;
let voices = [];

function populateVoiceList() {
    voices = window.speechSynthesis.getVoices();

    // We strictly use the filtered list for simplicity in this app
    const targetVoices = [
        // iOS / Mac
        { searchNames: ['Samantha'], label: 'Samantha (US)', icon: 'woman-outline', color: '#ff7675', type: 'US' },
        { searchNames: ['Ava'], label: 'Ava (Premium)', icon: 'sparkles-outline', color: '#a29bfe', type: 'US' },
        { searchNames: ['Evan'], label: 'Evan (Enhanced)', icon: 'flash-outline', color: '#6c5ce7', type: 'US' },
        { searchNames: ['Bells', 'Bell', 'ベル'], label: 'Bells (US)', icon: 'notifications-outline', color: '#fab1a0', type: 'Novelty' },
        { searchNames: ['Bubbles', 'Bubble', 'バブル'], label: 'Bubbles (US)', icon: 'water-outline', color: '#74b9ff', type: 'Novelty' },
        { searchNames: ['Jester', '道化', '道化師'], label: 'Jester (US)', icon: 'happy-outline', color: '#fdcb6e', type: 'Novelty' },

        // Windows / Chrome (PC)
        { searchNames: ['Google US English', 'Google US'], label: 'Google US', icon: 'logo-google', color: '#55efc4', type: 'PC' },
        { searchNames: ['Microsoft David', 'David'], label: 'David (US)', icon: 'man-outline', color: '#a29bfe', type: 'PC' },
        { searchNames: ['Microsoft Zira', 'Zira'], label: 'Zira (US)', icon: 'woman-outline', color: '#fd79a8', type: 'PC' },
        { searchNames: ['Microsoft Mark', 'Mark'], label: 'Mark (US)', icon: 'man-outline', color: '#6c5ce7', type: 'PC' }
    ];

    // Helper to render to a container
    const renderToContainer = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        const addedURIs = new Set(); // Per container tracking

        const createBtn = (voice, label, icon, color) => {
            const btn = document.createElement('button');
            btn.className = 'voice-btn';
            if (voice.voiceURI === currentVoiceURI) {
                btn.classList.add('active');
            }

            btn.innerHTML = `
                <div class="voice-icon" style="color: ${color}">
                    <ion-icon name="${icon}"></ion-icon>
                </div>
                <span class="voice-label">${label}</span>
            `;

            btn.onclick = () => {
                currentVoiceURI = voice.voiceURI;
                localStorage.setItem('voiceURI', currentVoiceURI);

                // Update ALL containers UI to reflect change
                document.querySelectorAll('.voice-selector .voice-btn').forEach(b => b.classList.remove('active'));

                // Since buttons are recreated/independent, we need to find all buttons corresponding to this URI and activate them
                // But simplified: just re-render is easiest, or just brute force matching style
                updateActiveVoiceUI(currentVoiceURI);

                // Small feedback beep/speak
                speakWord('Voice selected.');
            };

            container.appendChild(btn);
            addedURIs.add(voice.voiceURI);
        };

        targetVoices.forEach(target => {
            const voice = voices.find(v => target.searchNames.some(name => v.name.toLowerCase().includes(name.toLowerCase())));
            if (voice) {
                createBtn(voice, target.label, target.icon, target.color);
            }
        });

        // Fallback
        if (addedURIs.size === 0) {
            const defaultVoice = voices.find(v => v.name.includes('Google US English')) ||
                voices.find(v => v.lang.startsWith('en')) ||
                voices[0];
            if (defaultVoice) {
                createBtn(defaultVoice, 'Default English', 'volume-high-outline', '#b2bec3');
            }
        }
    };

    renderToContainer('voice-selector'); // Settings
    renderToContainer('listening-voice-selector'); // Listening Mode
}

function updateActiveVoiceUI(uri) {
    // Helper to visually update active state across all selectors
    // Re-running populate is heavy, better to just toggle classes if we can match
    // For now, simpler to just re-populate to ensure consistency or manual class toggle
    populateVoiceList();
}

function speakWord(text) {
    if ('speechSynthesis' in window) {
        // Cancel any current speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9; // Slightly slower for clarity

        if (currentVoiceURI) {
            const selectedVoice = voices.find(v => v.voiceURI === currentVoiceURI);
            if (selectedVoice) {
                utterance.voice = selectedVoice;
                // If user selected a non-English voice, we should still try to speak
                // but usually they will select an English one.
            }
        }

        window.speechSynthesis.speak(utterance);
    } else {
        alert('Text-to-speech is not supported in this browser.');
    }
}

// Quiz Logic
function startNewQuiz() {
    currentQuiz.score = 0;
    currentQuiz.currentQuestionIndex = 0;
    currentScoreEl.textContent = 0;

    // Select 10 random words
    const shuffled = [...allWords].sort(() => 0.5 - Math.random());
    currentQuiz.questions = shuffled.slice(0, 10);
    quizProgressTotal.textContent = currentQuiz.questions.length;

    showQuestion();
}

function showQuestion() {
    if (currentQuiz.questions.length === 0) return;

    currentQuiz.isAnswered = false;
    quizFeedback.classList.remove('show', 'correct', 'wrong');

    const currentQ = currentQuiz.questions[currentQuiz.currentQuestionIndex];
    quizProgressCurrent.textContent = currentQuiz.currentQuestionIndex + 1;

    quizQuestionWord.textContent = currentQ.word;
    quizQuestionPos.textContent = currentQ.pos;

    // Generate options: 1 correct, 3 wrong
    const correctOption = currentQ;
    const wrongOptions = allWords
        .filter(w => w.word !== currentQ.word)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

    const options = [correctOption, ...wrongOptions].sort(() => 0.5 - Math.random());

    quizOptionsEl.innerHTML = '';
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt.meaning;
        btn.onclick = () => handleAnswer(opt, correctOption, btn);
        quizOptionsEl.appendChild(btn);
    });
}

function handleAnswer(selected, correct, btnElement) {
    if (currentQuiz.isAnswered) return;
    currentQuiz.isAnswered = true;

    const isCorrect = selected.word === correct.word;

    // UI Update
    const allBtns = quizOptionsEl.querySelectorAll('.option-btn');
    allBtns.forEach(btn => {
        if (btn.textContent === correct.meaning) {
            btn.classList.add('correct');
        } else if (btn === btnElement && !isCorrect) {
            btn.classList.add('wrong');
        }
    });

    if (isCorrect) {
        currentQuiz.score++;
        currentScoreEl.textContent = currentQuiz.score;
        quizFeedback.className = 'quiz-feedback show correct';
        feedbackText.textContent = 'Excellent!';
    } else {
        quizFeedback.className = 'quiz-feedback show wrong';
        feedbackText.textContent = `Correct: ${correct.meaning}`;
    }
}

function nextQuestion() {
    currentQuiz.currentQuestionIndex++;
    if (currentQuiz.currentQuestionIndex < currentQuiz.questions.length) {
        showQuestion();
    } else {
        alert(`Quiz Finished! Score: ${currentQuiz.score}/${currentQuiz.questions.length}`);
        startNewQuiz(); // Restart or go back to menu could be better
    }
}

// Settings Logic
// Theme Logic
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    currentTheme = theme;
    localStorage.setItem('theme', theme);

    // Update buttons
    themeBtns.forEach(btn => {
        if (btn.dataset.theme === theme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}


