// DOM Elements
const views = {
    loading: document.getElementById('loading-view'),
    list: document.getElementById('list-view'),
    flashCard: document.getElementById('flash-card-view'),
    quiz: document.getElementById('quiz-view'),
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
    Object.values(views).forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
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
        backBtn.innerHTML = '<ion-icon name="arrow-back-outline"></ion-icon> Back to Lists';
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
            <span>List ${i + 1}</span>
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
    const voiceContainer = document.getElementById('voice-selector');

    // Target voices in preferred order with metadata
    const targetVoices = [
        { name: 'Samantha', label: 'Samantha (US)', icon: 'woman-outline', color: '#ff7675', type: 'US' },
        { name: 'Bells', label: 'ベル (US)', icon: 'notifications-outline', color: '#fab1a0', type: 'Novelty' },
        { name: 'Bubbles', label: 'Bubble (US)', icon: 'water-outline', color: '#74b9ff', type: 'Novelty' },
        { name: 'Jester', label: '道化 (US)', icon: 'happy-outline', color: '#fdcb6e', type: 'Novelty' }
    ];

    voiceContainer.innerHTML = '';

    // Track added voices to avoid duplicates
    const addedURIs = new Set();

    // Helper to create button
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

            // Update UI
            const allBtns = voiceContainer.querySelectorAll('.voice-btn');
            allBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Speak test
            speakWord('Hello, this is a test.');
        };

        voiceContainer.appendChild(btn);
        addedURIs.add(voice.voiceURI);
    };

    // 1. Try to find specific target voices (Exact or partial match)
    targetVoices.forEach(target => {
        // Match by name loosely
        const voice = voices.find(v => v.name.includes(target.name));
        if (voice) {
            createBtn(voice, target.label, target.icon, target.color);
        }
    });

    // 2. Fallback: If NONE of the requested voices found (e.g. non-iOS), show default English
    // This ensures the app isn't broken on PC/Android
    if (addedURIs.size === 0) {
        const defaultVoice = voices.find(v => v.name.includes('Google US English')) ||
            voices.find(v => v.lang.startsWith('en')) ||
            voices[0];

        if (defaultVoice) {
            createBtn(defaultVoice, 'Default English', 'volume-high-outline', '#b2bec3');
        }
    }
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


