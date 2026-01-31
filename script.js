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
let currentSheet = 'TOEFL_Vocabulary';
let allWords = [];
let vocabCache = {}; // Cache for sheet data: { 'SheetName': [data] }

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
let fcCurrentFace = 0;  // 0=front(word), 1=POS1, 2=POS2, 3=POS3
let fcTotalFaces = 2;   // Minimum 2 (word + POS1), max 4
// Swipe State
let touchStartX = 0;
let touchEndX = 0;
let lastActiveView = 'list-view'; // Track last active view for settings return
let isSwiping = false;

// Audio Service Logic (IndexedDB + Google Cloud TTS)
class AudioService {
    constructor() {
        this.dbName = 'AudioCacheDB';
        this.dbVersion = 1;
        this.db = null;
        this.currentAudio = null; // Track active audio instance
        this.initDB();
    }

    initDB() {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onerror = (event) => {
            console.error("IndexedDB error:", event.target.error);
        };

        request.onsuccess = (event) => {
            this.db = event.target.result;
            console.log("AudioCacheDB opened successfully");
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Create an objectStore for this database
            if (!db.objectStoreNames.contains('audio')) {
                db.createObjectStore('audio', { keyPath: 'id' });
            }
        };
    }

    async getAudio(text, voiceId) {
        if (!text) return null;

        // Standard voices (Free) should NOT use Cloud TTS
        if (voiceId === 'STANDARD_M' || voiceId === 'STANDARD_F') {
            return null; // Force Web Speech API fallback
        }

        const id = `${text}-${voiceId}`; // Unique key based on text and voice

        // 1. Try to get from Cache
        try {
            const cachedBlob = await this.getFromCache(id);
            if (cachedBlob) {
                console.log('Audio served from cache (IndexedDB)');
                return URL.createObjectURL(cachedBlob);
            }
        } catch (e) {
            console.warn('Cache lookup failed:', e);
        }

        // 2. If not in cache, fetch from Google Cloud TTS
        console.log('Fetching audio from Google Cloud API...');
        try {
            const audioContent = await this.fetchFromGoogleCloud(text, voiceId);

            // 3. Save to Cache
            const blob = this.base64ToBlob(audioContent, 'audio/mp3');
            this.saveToCache(id, blob);

            return URL.createObjectURL(blob);
        } catch (error) {
            console.error('TTS API Error:', error);
            // Fallback to Web Speech API happens in playAudio
            return null;
        }
    }

    getFromCache(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                // If DB is not ready yet (rare race condition), retry once after short delay
                setTimeout(() => {
                    if (!this.db) {
                        reject('DB not initialized');
                        return;
                    }
                    this.getFromCache(id).then(resolve).catch(reject);
                }, 500);
                return;
            }

            const transaction = this.db.transaction(['audio'], 'readonly');
            const store = transaction.objectStore('audio');
            const request = store.get(id);

            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result.blob);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    saveToCache(id, blob) {
        if (!this.db) return;
        const transaction = this.db.transaction(['audio'], 'readwrite');
        const store = transaction.objectStore('audio');
        const item = {
            id: id,
            blob: blob,
            timestamp: Date.now()
        };
        store.put(item);
    }

    async clearCache() {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve();
            const transaction = this.db.transaction(['audio'], 'readwrite');
            const store = transaction.objectStore('audio');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('Audio cache cleared');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getCacheSize() {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(0);
            const transaction = this.db.transaction(['audio'], 'readonly');
            const store = transaction.objectStore('audio');
            const request = store.getAll(); // Be careful with huge DBs, but for <500MB it's okay

            request.onsuccess = () => {
                let totalSize = 0;
                if (request.result) {
                    request.result.forEach(item => {
                        totalSize += item.blob.size;
                    });
                }
                resolve(totalSize);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async fetchFromGoogleCloud(text, voiceId) {
        if (!CONFIG.GOOGLE_CLOUD_API_KEY) throw new Error("API Key missing");

        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${CONFIG.GOOGLE_CLOUD_API_KEY}`;

        // Determine gender/name based on voiceId config
        // voiceId passed here is expected to be 'MALE' or 'FEMALE' or specific name
        let voiceName = voiceId;

        // Mapping convenience (if user passes 'MALE' or 'FEMALE')
        if (voiceId === 'MALE' && CONFIG.VOICE_SETTINGS?.MALE) voiceName = CONFIG.VOICE_SETTINGS.MALE;
        if (voiceId === 'FEMALE' && CONFIG.VOICE_SETTINGS?.FEMALE) voiceName = CONFIG.VOICE_SETTINGS.FEMALE;

        const requestBody = {
            input: { text: text },
            voice: { languageCode: 'en-US', name: voiceName },
            audioConfig: { audioEncoding: 'MP3' }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'API Request Failed');
        }

        const data = await response.json();
        return data.audioContent; // Base64 string
    }

    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    stopAudio() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0; // Reset
            this.currentAudio.src = ""; // Detach
            this.currentAudio = null;
        }
        window.speechSynthesis.cancel();
    }

    // Unified player method with optional callbacks
    async playAudio(text, preferredVoiceId = null, options = {}) {
        const { onStart, onEnd } = options;

        // Stop any current playback
        this.stopAudio();

        // Determine voice
        // Currently selected voice in app state (from simple selector)
        let targetVoice = preferredVoiceId || currentVoiceURI;

        // CHECK: Is this a Neural voice (Cloud) or a Standard voice (OS)?
        // Neural voices handle: MALE, FEMALE, en-US-Neural2...
        // Standard voices: STANDARD_M, STANDARD_F
        const isNeural = (targetVoice === 'MALE' || targetVoice === 'FEMALE' || targetVoice.startsWith('en-US-Neural2'));

        let startCalled = false;

        if (isNeural) {
            try {
                const audioUrl = await this.getAudio(text, targetVoice);
                if (audioUrl) {
                    const audio = new Audio(audioUrl);
                    this.currentAudio = audio; // Track it

                    // Prevent double onEnd calls
                    let endCalled = false;
                    const callOnEnd = () => {
                        if (!endCalled && onEnd) {
                            endCalled = true;
                            onEnd();
                        }
                    };

                    audio.onended = () => {
                        this.currentAudio = null;
                        URL.revokeObjectURL(audioUrl); // Clean up
                        callOnEnd();
                    };

                    audio.onerror = () => {
                        this.currentAudio = null;
                        callOnEnd();
                    };

                    try {
                        if (onStart) {
                            onStart();
                            startCalled = true;
                        }
                        await audio.play();

                        // Fallback timeout for mobile - ensure onEnd gets called
                        // Use audio duration if available, otherwise estimate
                        const fallbackDelay = (audio.duration ? audio.duration * 1000 : 10000) + 1000;
                        setTimeout(() => {
                            if (this.currentAudio === audio && !audio.ended) {
                                // Audio should have ended but didn't trigger event
                                callOnEnd();
                            }
                        }, fallbackDelay);
                    } catch (playError) {
                        console.error('Audio play error:', playError);
                        callOnEnd();
                    }
                    return;
                }
            } catch (e) {
                console.error('Cloud TTS failed, falling back to Web Speech API', e);
                // Reset if onStart was already called
                if (startCalled && onEnd) {
                    onEnd();
                    startCalled = false;
                }
            }
        }

        // Fallback or Standard Choice: Web Speech API
        // This supports background audio mixing (ducking) on many devices
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';

        // Apply voice - select appropriate male/female voice
        const voices = window.speechSynthesis.getVoices();
        let selected = null;

        // Try to find a good match for Male or Female
        if (targetVoice === 'STANDARD_M' || targetVoice === 'MALE') {
            // Male voices
            selected = voices.find(v => (v.name.includes('Male') || v.name.includes('David') || v.name.includes('Daniel')) && v.lang.startsWith('en'));
        } else if (targetVoice === 'STANDARD_F' || targetVoice === 'FEMALE') {
            // Female voices
            selected = voices.find(v => (v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Samantha')) && v.lang.startsWith('en'));
        } else {
            // Try exact match or nothing
            selected = voices.find(v => v.voiceURI === targetVoice || v.name === targetVoice);
        }

        if (selected) utterance.voice = selected;

        // Flag to track if onEnd has been called (prevent double calls)
        let endCalled = false;
        const callOnEnd = () => {
            if (!endCalled && onEnd) {
                endCalled = true;
                onEnd();
            }
        };

        // Timeout fallback for mobile browsers where onend may not fire
        // Estimate ~150ms per word average
        const wordCount = text.split(/\s+/).length;
        const estimatedDuration = Math.max(2000, wordCount * 400); // Min 2 seconds
        let timeoutId = null;

        utterance.onstart = () => {
            if (onStart && !startCalled) onStart();
            // Set timeout as fallback
            timeoutId = setTimeout(() => {
                if (window.speechSynthesis.speaking) {
                    // Still speaking, extend timeout
                    timeoutId = setTimeout(callOnEnd, 2000);
                } else {
                    callOnEnd();
                }
            }, estimatedDuration);
        };
        utterance.onend = () => {
            if (timeoutId) clearTimeout(timeoutId);
            callOnEnd();
        };
        utterance.onerror = () => {
            if (timeoutId) clearTimeout(timeoutId);
            callOnEnd();
        };

        window.speechSynthesis.speak(utterance);
    }
}

const audioService = new AudioService();

// Review List State (persisted in localStorage)
let reviewList = JSON.parse(localStorage.getItem('reviewList') || '{}');

function isWordInReviewList(word) {
    return reviewList[word] === true;
}

function toggleReviewWord(word) {
    if (reviewList[word]) {
        delete reviewList[word];
    } else {
        reviewList[word] = true;
    }
    localStorage.setItem('reviewList', JSON.stringify(reviewList));
    return reviewList[word] === true;
}

// Helper to update Start Review button count dynamically
function updateReviewStartBtn(pageWords) {
    const btn = document.getElementById('fc-review-start-btn');
    if (!btn) return;

    const reviewCount = pageWords.filter(w => isWordInReviewList(w.word)).length;
    btn.innerHTML = `<ion-icon name="bookmark"></ion-icon> Start Review (${reviewCount})`;
    btn.disabled = reviewCount === 0;
}


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
    preloadAllSheets(); // Preload all sheets at startup
    setupEventListeners();
    setupSheetSelectors();
});

// Preload all vocabulary sheets in parallel at startup
async function preloadAllSheets() {
    const sheets = ['TOEFL_Vocabulary', 'My_Vocabulary'];

    let gasUrl = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) {
        gasUrl = CONFIG.GAS_URL;
    }

    if (!gasUrl) {
        console.log('No GAS URL, using mock data.');
        allWords = MOCK_WORDS;
        vocabCache['TOEFL_Vocabulary'] = MOCK_WORDS;
        vocabCache['My_Vocabulary'] = MOCK_WORDS;
        renderWordList();
        switchView('list-view');
        return;
    }

    // Fetch all sheets in parallel
    const fetchPromises = sheets.map(async (sheetName) => {
        try {
            const url = new URL(gasUrl);
            url.searchParams.append('sheet', sheetName);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

            const response = await fetch(url.toString(), { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            if (data && data.length > 0) {
                vocabCache[sheetName] = data;
                console.log(`Preloaded ${sheetName}: ${data.length} words`);
            }
        } catch (error) {
            console.error(`Error preloading ${sheetName}:`, error);
            // Continue with other sheets even if one fails
        }
    });

    await Promise.all(fetchPromises);

    // Set current sheet data
    if (vocabCache[currentSheet]) {
        allWords = vocabCache[currentSheet];
    } else if (Object.keys(vocabCache).length > 0) {
        // Fallback to any available cached sheet
        const firstCached = Object.keys(vocabCache)[0];
        currentSheet = firstCached;
        allWords = vocabCache[firstCached];
    } else {
        // All failed, use mock data
        allWords = MOCK_WORDS;
    }

    renderWordList();

    if (document.getElementById('loading-view').classList.contains('active')) {
        switchView('list-view');
    }
}

function setupSheetSelectors() {
    const sheetBtns = document.querySelectorAll('.sheet-btn');
    sheetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sheet = btn.dataset.sheet;
            if (sheet === currentSheet) return;

            // Update UI
            sheetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Switch Sheet
            currentSheet = sheet;
            currentGroupIndex = null; // Reset group
            wordSearchInput.value = ''; // Reset search

            // Fetch new data
            fetchWords();
        });
    });
}

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

    // Settings logic moved to end of file for state preservation
    // ...

    // Clear Cache Button Logic
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const cacheSizeDisplay = document.getElementById('cache-size-display');

    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear the audio cache? This will require re-downloading audio.')) {
                await audioService.clearCache();
                alert('Cache cleared.');
                updateCacheSize();
            }
        });
    }

    async function updateCacheSize() {
        if (!cacheSizeDisplay) return;
        const size = await audioService.getCacheSize();
        const mb = (size / (1024 * 1024)).toFixed(2);
        cacheSizeDisplay.textContent = `${mb} MB`;
    }

    // Update size when settings view is opened
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            updateCacheSize();
        });
    }

    // Initial check
    setTimeout(updateCacheSize, 1000);

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

    // Template Elements
    const listeningTemplateBtn = document.getElementById('listening-template-btn');
    const listeningTemplateListContainer = document.getElementById('listening-template-list-container');
    const listeningTemplateEditorContainer = document.getElementById('listening-template-editor-container');
    const templateListBackBtn = document.getElementById('template-list-back-btn');
    const templateNewBtn = document.getElementById('template-new-btn');
    const templateList = document.getElementById('template-list');
    const templateEditorBackBtn = document.getElementById('template-editor-back-btn');
    const templateSaveBtn = document.getElementById('template-save-btn');
    const templateTitleInput = document.getElementById('template-title-input');
    const templateContentInput = document.getElementById('template-content-input');
    const templateEditorTitle = document.getElementById('template-editor-title');

    // Template State
    let listeningTemplates = JSON.parse(localStorage.getItem('listeningTemplates') || '[]');
    let editingTemplateIndex = -1; // -1 means new template

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

    // --- Template Functions ---
    function showListeningContainer(containerName) {
        listeningInputContainer.classList.add('hidden');
        listeningTemplateListContainer.classList.add('hidden');
        listeningTemplateEditorContainer.classList.add('hidden');
        listeningPlayerContainer.classList.add('hidden');

        switch (containerName) {
            case 'input':
                listeningInputContainer.classList.remove('hidden');
                break;
            case 'templateList':
                listeningTemplateListContainer.classList.remove('hidden');
                renderTemplateList();
                break;
            case 'templateEditor':
                listeningTemplateEditorContainer.classList.remove('hidden');
                break;
            case 'player':
                listeningPlayerContainer.classList.remove('hidden');
                break;
        }
    }

    function renderTemplateList() {
        templateList.innerHTML = '';

        if (listeningTemplates.length === 0) {
            templateList.innerHTML = `
                <div class="template-empty">
                    <ion-icon name="document-text-outline"></ion-icon>
                    <p>No templates yet.<br>Create one to get started!</p>
                </div>
            `;
            return;
        }

        listeningTemplates.forEach((template, index) => {
            const item = document.createElement('div');
            item.className = 'template-item';
            item.innerHTML = `
                <div class="template-item-icon">
                    <ion-icon name="document-text-outline"></ion-icon>
                </div>
                <div class="template-item-info">
                    <div class="template-item-title">${escapeHtml(template.title)}</div>
                    <div class="template-item-preview">${escapeHtml(template.content.substring(0, 50))}...</div>
                </div>
                <div class="template-item-actions">
                    <button class="template-item-edit" data-index="${index}">
                        <ion-icon name="create-outline"></ion-icon>
                    </button>
                    <button class="template-item-delete" data-index="${index}">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
            `;

            // Click to use template
            item.addEventListener('click', (e) => {
                if (e.target.closest('.template-item-delete')) return;
                if (e.target.closest('.template-item-edit')) return;
                listeningTextInput.value = template.content;
                showListeningContainer('input');
            });

            // Edit button
            const editBtn = item.querySelector('.template-item-edit');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                editingTemplateIndex = index;
                templateEditorTitle.textContent = 'Edit Template';
                templateTitleInput.value = template.title;
                templateContentInput.value = template.content;
                showListeningContainer('templateEditor');
            });

            // Delete button
            const deleteBtn = item.querySelector('.template-item-delete');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete "${template.title}"?`)) {
                    listeningTemplates.splice(index, 1);
                    localStorage.setItem('listeningTemplates', JSON.stringify(listeningTemplates));
                    renderTemplateList();
                }
            });

            templateList.appendChild(item);
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Template Button -> Show Template List
    if (listeningTemplateBtn) {
        listeningTemplateBtn.addEventListener('click', () => {
            showListeningContainer('templateList');
        });
    }

    // Template List Back Button
    if (templateListBackBtn) {
        templateListBackBtn.addEventListener('click', () => {
            showListeningContainer('input');
        });
    }

    // New Template Button
    if (templateNewBtn) {
        templateNewBtn.addEventListener('click', () => {
            editingTemplateIndex = -1;
            templateEditorTitle.textContent = 'New Template';
            templateTitleInput.value = '';
            templateContentInput.value = '';
            showListeningContainer('templateEditor');
        });
    }

    // Template Editor Back Button
    if (templateEditorBackBtn) {
        templateEditorBackBtn.addEventListener('click', () => {
            showListeningContainer('templateList');
        });
    }

    // Template Save Button
    if (templateSaveBtn) {
        templateSaveBtn.addEventListener('click', () => {
            const title = templateTitleInput.value.trim();
            const content = templateContentInput.value.trim();

            if (!title) {
                alert('Please enter a title.');
                return;
            }
            if (!content) {
                alert('Please enter content.');
                return;
            }

            const newTemplate = { title, content, createdAt: Date.now() };

            if (editingTemplateIndex >= 0) {
                listeningTemplates[editingTemplateIndex] = newTemplate;
            } else {
                listeningTemplates.push(newTemplate);
            }

            localStorage.setItem('listeningTemplates', JSON.stringify(listeningTemplates));
            showListeningContainer('templateList');
        });
    }

    // Setup Listening Mode
    function initListeningMode() {
        // Update voice label - Removed as element doesn't exist
        // const voice = voices.find(v => v.voiceURI === currentVoiceURI);
        // if (voice && listeningVoiceLabel) {
        //     listeningVoiceLabel.textContent = voice.name;
        // }

        // Prepare UI - use helper function
        showListeningContainer('input');
        listeningTextInput.value = '';

        // Reset loop and blind mode states
        listeningLoopEnabled = false;
        listeningLoopBtn.classList.remove('active');

        listeningBlindEnabled = false;
        listeningBlindBtn.classList.remove('active');
        listeningTextDisplay.classList.remove('blinded');
        listeningBlindOverlay.classList.add('hidden');
        const blindIcon = listeningBlindBtn.querySelector('ion-icon');
        if (blindIcon) blindIcon.name = 'eye-outline';
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

        // Reset cached audio when starting new session
        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement = null;
        }
        fullAudioUrl = null;
        fullAudioText = null;
        fullAudioVoice = null;

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

    // Play Audio logic for Listening Mode
    // Note: With Cloud TTS (Blob), we lose word-by-word 'onboundary' events.
    // We will switch to a simpler playback model: Play audio, and highlight text based on time estimation or just active state.
    // For high quality audio, precise kareoke-style highlighting is complex to implement without server timestamps.
    // We will simplify: Highlight whole text or paragraph, or just show playing state.

    let currentAudioElement = null;
    let fullAudioUrl = null; // Cache the full audio URL
    let fullAudioText = null; // Track which text the cached audio is for
    let fullAudioVoice = null; // Track which voice the cached audio is for

    async function playListeningAudio(startIndex) {
        listeningIsPaused = false;
        updatePlayIcon(true);

        // Check if we should use Cloud TTS (Pro voices) or Web Speech API (Free voices)
        const isNeural = (currentVoiceURI === 'MALE' || currentVoiceURI === 'FEMALE' || currentVoiceURI.startsWith('en-US-Neural2'));

        // Highlighting logic
        highlightWord(startIndex);

        if (isNeural) {
            // Check if we already have the full audio loaded and it's for the same text/voice
            if (currentAudioElement && fullAudioText === listeningText && fullAudioVoice === currentVoiceURI) {
                // Reuse existing audio, just seek to the estimated position
                if (currentAudioElement.duration) {
                    const progress = startIndex / listeningText.length;
                    currentAudioElement.currentTime = progress * currentAudioElement.duration;
                }
                currentAudioElement.loop = listeningLoopEnabled;
                currentAudioElement.play();
                return;
            }

            // Stop previous audio if different
            if (currentAudioElement) {
                currentAudioElement.pause();
                currentAudioElement = null;
            }
            audioService.stopAudio();

            // Try Cloud TTS for Pro voices - always use FULL text
            try {
                const audioUrl = await audioService.getAudio(listeningText, currentVoiceURI);

                if (audioUrl) {
                    const audio = new Audio(audioUrl);
                    currentAudioElement = audio;
                    fullAudioUrl = audioUrl;
                    fullAudioText = listeningText;
                    fullAudioVoice = currentVoiceURI;

                    // Use native loop for reliable background looping
                    audio.loop = listeningLoopEnabled;

                    // If starting from a position other than 0, wait for metadata then seek
                    if (startIndex > 0) {
                        audio.onloadedmetadata = () => {
                            const progress = startIndex / listeningText.length;
                            audio.currentTime = progress * audio.duration;
                        };
                    }

                    // Time-based word tracking for Cloud TTS
                    audio.ontimeupdate = () => {
                        if (audio.duration && listeningCharIndices.length > 0) {
                            // Estimate word position based on time progress
                            const progress = audio.currentTime / audio.duration;
                            const estimatedCharIndex = Math.floor(progress * listeningText.length);
                            highlightWord(estimatedCharIndex);
                        }
                    };

                    audio.onended = () => {
                        // Only handle non-loop case (loop is handled by audio.loop)
                        if (!listeningLoopEnabled) {
                            listeningIsPaused = false;
                            updatePlayIcon(false);
                            clearHighlights();
                        }
                    };

                    audio.onerror = (e) => {
                        console.error("Audio playback error", e);
                        updatePlayIcon(false);
                    };

                    audio.play();
                    return;
                }
            } catch (e) {
                console.error("AudioService error in listening mode", e);
            }
        }

        // Use Web Speech API for Free voices or as fallback for Pro voices
        // For Web Speech API, we still use substring since we can't seek
        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement = null;
        }
        audioService.stopAudio();
        playListeningAudioFallback(startIndex);
    }

    function playListeningAudioFallback(startIndex) {
        // ... (Original logic for Web Speech API fallback)
        // Re-implementing simplified fallback for brevity and reliability
        window.speechSynthesis.cancel();

        const textToSpeak = listeningText.substring(startIndex);
        listeningUtterance = new SpeechSynthesisUtterance(textToSpeak);

        // Voice selection
        // Map our voice ID back to a real voice object for Web Speech API
        const voices = window.speechSynthesis.getVoices();
        let voice = null;

        // Standard (Free) voices - use Web Speech API
        if (currentVoiceURI === 'STANDARD_M') {
            voice = voices.find(v => (v.name.includes('Male') || v.name.includes('David') || v.name.includes('Daniel')) && v.lang.startsWith('en'));
        } else if (currentVoiceURI === 'STANDARD_F') {
            voice = voices.find(v => (v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Samantha')) && v.lang.startsWith('en'));
        } else if (currentVoiceURI === 'MALE') {
            // Pro voice fallback (if Cloud TTS failed) - try similar
            voice = voices.find(v => v.name.includes('David') || v.name.includes('Male'));
        } else if (currentVoiceURI === 'FEMALE') {
            // Pro voice fallback (if Cloud TTS failed)
            voice = voices.find(v => v.name.includes('Zira') || v.name.includes('Female'));
        }

        if (!voice) voice = voices.find(v => v.lang === 'en-US'); // Fallback

        if (voice) listeningUtterance.voice = voice;

        listeningUtterance.onboundary = (event) => {
            if (event.name === 'word') {
                highlightWord(startIndex + event.charIndex);
            }
        };

        listeningUtterance.onend = () => {
            if (listeningLoopEnabled) {
                playListeningAudioFallback(0);
            } else {
                updatePlayIcon(false);
                clearHighlights();
            }
        };

        window.speechSynthesis.speak(listeningUtterance);
    }

    // Controls
    listeningPlayBtn.onclick = () => {
        if (listeningIsPaused) {
            // Resume
            if (currentAudioElement) {
                currentAudioElement.play();
                listeningIsPaused = false;
                updatePlayIcon(true);
            } else {
                playListeningAudio(listeningPausedAt);
            }
        } else {
            // Pause
            if (currentAudioElement && !currentAudioElement.paused) {
                currentAudioElement.pause();
                listeningIsPaused = true;
                updatePlayIcon(false);
                // We don't have precise pause position for Blob, so we might restart from block
            } else if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
                listeningIsPaused = true;
                updatePlayIcon(false);
            } else {
                // Start
                playListeningAudio(0);
            }
        }
    };

    // RW/FF - Simple implementation for Blob audio
    const SKIP_SECONDS = 5;

    listeningRwBtn.onclick = () => {
        if (currentAudioElement) {
            currentAudioElement.currentTime = Math.max(0, currentAudioElement.currentTime - SKIP_SECONDS);
        } else {
            // Fallback logic specific
            let newIndex = Math.max(0, listeningCurrentCharIndex - 75);
            playListeningAudioFallback(newIndex);
        }
    };

    listeningFfBtn.onclick = () => {
        if (currentAudioElement) {
            currentAudioElement.currentTime = Math.min(currentAudioElement.duration, currentAudioElement.currentTime + SKIP_SECONDS);
        } else {
            // Fallback logic specific
            let newIndex = Math.min(listeningText.length - 1, listeningCurrentCharIndex + 75);
            playListeningAudioFallback(newIndex);
        }
    };

    // Loop Button
    listeningLoopBtn.onclick = () => {
        listeningLoopEnabled = !listeningLoopEnabled;
        listeningLoopBtn.classList.toggle('active', listeningLoopEnabled);

        // Update current audio element's loop property for background playback
        if (currentAudioElement) {
            currentAudioElement.loop = listeningLoopEnabled;
        }
    };

    // Blind Button
    listeningBlindBtn.onclick = () => {
        listeningBlindEnabled = !listeningBlindEnabled;
        listeningBlindBtn.classList.toggle('active', listeningBlindEnabled);
        listeningTextDisplay.classList.toggle('blinded', listeningBlindEnabled);
        listeningBlindOverlay.classList.toggle('hidden', !listeningBlindEnabled);

        const blindIcon = listeningBlindBtn.querySelector('ion-icon');
        if (blindIcon) {
            blindIcon.name = listeningBlindEnabled ? 'eye-off-outline' : 'eye-outline';
        }
    };

    function stopListening() {
        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement = null;
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
        // Update current character index for RW/FF functionality
        listeningCurrentCharIndex = charIndex;

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
    fcCloseBtn.addEventListener('click', () => {
        renderWordList(); // Refresh to update review button states
        switchView('list-view');
    });
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
        audioService.playAudio(word, currentVoiceURI, {
            onStart: () => fcAudioBtn.classList.add('playing'),
            onEnd: () => fcAudioBtn.classList.remove('playing')
        });
    });

    // Example Audio button (prevent flip) - plays correct example based on current face
    const fcExampleAudioBtn = document.getElementById('fc-example-audio-btn');
    fcExampleAudioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = fcList[fcCurrentIndex];
        let example;

        // Get the correct example based on current face
        if (fcCurrentFace === 1) {
            example = item.example;
        } else if (fcCurrentFace === 2) {
            example = item.example2;
        } else if (fcCurrentFace === 3) {
            example = item.example3;
        } else {
            example = item.example; // Default to first example
        }

        if (example) {
            audioService.playAudio(example, currentVoiceURI, {
                onStart: () => fcExampleAudioBtn.classList.add('playing'),
                onEnd: () => fcExampleAudioBtn.classList.remove('playing')
            });
        }
    });

    // Flash card review button
    // Flash card review buttons (front and back)
    const fcReviewBtnFront = document.getElementById('fc-review-btn-front');
    const fcReviewBtnBack = document.getElementById('fc-review-btn-back');

    const updateBothReviewBtns = (isInReview) => {
        [fcReviewBtnFront, fcReviewBtnBack].forEach(btn => {
            btn.classList.toggle('active', isInReview);
            const icon = btn.querySelector('ion-icon');
            icon.name = isInReview ? 'bookmark' : 'bookmark-outline';
        });
    };

    const handleReviewClick = (e) => {
        e.stopPropagation();
        const currentWord = fcList[fcCurrentIndex].word;
        const isNowInReview = toggleReviewWord(currentWord);
        updateBothReviewBtns(isNowInReview);
    };

    fcReviewBtnFront.addEventListener('click', handleReviewClick);
    fcReviewBtnBack.addEventListener('click', handleReviewClick);

    // Initialize Voices
    populateVoiceList();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoiceList;
    }
}

// Data Handling
async function fetchWords() {
    // Check cache first
    if (vocabCache[currentSheet]) {
        console.log(`Loading ${currentSheet} from cache`);
        allWords = vocabCache[currentSheet];
        renderWordList();

        // Ensure we are in list view (if not already)
        if (document.getElementById('loading-view').classList.contains('active')) {
            switchView('list-view');
        }
        return;
    }

    switchView('loading-view');

    let gasUrl = null;
    if (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) {
        gasUrl = CONFIG.GAS_URL;
    }

    if (gasUrl) {
        try {
            // Append sheet param
            const url = new URL(gasUrl);
            url.searchParams.append('sheet', currentSheet);

            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s

            const response = await fetch(url.toString(), { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            if (data && data.length > 0) {
                vocabCache[currentSheet] = data; // Cache the result
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

    const sheetSelector = document.querySelector('.sheet-selector');

    // Filter by Type first
    let candidates = allWords;

    // If searching, show all matching results (ignores groups)
    if (searchTerm) {
        if (sheetSelector) sheetSelector.style.display = 'flex';
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
        if (sheetSelector) sheetSelector.style.display = 'flex';
        renderGroups(candidates);
    } else {
        if (sheetSelector) sheetSelector.style.display = 'none';
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
        backBtn.className = 'primary-btn small back-action-btn';
        backBtn.innerHTML = '<ion-icon name="arrow-back-outline"></ion-icon> Back';
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

        // Start Review button (only review words in this group)
        const reviewWords = pageWords.filter(w => isWordInReviewList(w.word));
        const fcReviewStartBtn = document.createElement('button');
        fcReviewStartBtn.className = 'primary-btn small review-start-btn';
        fcReviewStartBtn.id = 'fc-review-start-btn';
        fcReviewStartBtn.innerHTML = `<ion-icon name="bookmark"></ion-icon> Start Review (${reviewWords.length})`;
        fcReviewStartBtn.disabled = reviewWords.length === 0;
        fcReviewStartBtn.onclick = () => {
            // Recalculate at click time to get current review words
            const currentReviewWords = pageWords.filter(w => isWordInReviewList(w.word));
            if (currentReviewWords.length > 0) {
                const shuffled = [...currentReviewWords].sort(() => 0.5 - Math.random());
                startFlashCards(shuffled);
            }
        };

        headerDiv.appendChild(backBtn);
        headerDiv.appendChild(fcStartBtn);
        headerDiv.appendChild(fcReviewStartBtn);
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

        // Determine label based on sheet
        let prefix = 'Vocab';
        if (currentSheet === 'TOEFL_Vocabulary') {
            prefix = 'TOEFL';
        } else if (currentSheet === 'My_Vocabulary') {
            prefix = 'My';
        }

        btn.innerHTML = `
            <span>${prefix} ${i + 1}</span>
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
    fcCurrentFace = 0;  // Reset to front face

    switchView('flash-card-view');
    renderCard();
}

// Calculate total faces based on available POS data
function getFaceCount(item) {
    let count = 2; // Minimum: word + POS1
    if (item.pos2 && item.meaning2) count++;
    if (item.pos3 && item.meaning3) count++;
    return count;
}

function renderCard() {
    const item = fcList[fcCurrentIndex];

    // Calculate total faces for this word
    fcTotalFaces = getFaceCount(item);
    fcCurrentFace = 0;  // Always start at front

    // Temporarily disable transition to prevent seeing content switch
    fcCard.style.transition = 'none';
    fcCard.classList.remove('flipped');
    fcIsFlipped = false;

    // Force reflow to apply the class removal instantly
    void fcCard.offsetWidth;

    // Restore transition after a brief delay
    setTimeout(() => {
        fcCard.style.transition = '';
    }, 50);

    // Set front content (always the word)
    fcWord.textContent = item.word;

    // Set back content to POS1 initially
    fcMeaning.innerHTML = `<span class="pos">${item.pos}</span> ${item.meaning}`;
    fcExample.textContent = item.example || '';
    fcExampleJa.textContent = item.example_ja || '';

    // Progress
    fcProgress.textContent = `${fcCurrentIndex + 1} / ${fcList.length}`;

    // Update review button state on both sides
    const isInReview = isWordInReviewList(item.word);
    [document.getElementById('fc-review-btn-front'), document.getElementById('fc-review-btn-back')].forEach(btn => {
        btn.classList.toggle('active', isInReview);
        const icon = btn.querySelector('ion-icon');
        icon.name = isInReview ? 'bookmark' : 'bookmark-outline';
    });

    // Render face indicator dots
    renderFaceIndicator();
}

// Render the face indicator dots
function renderFaceIndicator() {
    const indicator = document.getElementById('fc-face-indicator');
    if (!indicator) return;

    indicator.innerHTML = '';
    for (let i = 0; i < fcTotalFaces; i++) {
        const dot = document.createElement('span');
        dot.className = 'fc-face-dot' + (i === fcCurrentFace ? ' active' : '');
        dot.onclick = (e) => {
            e.stopPropagation();
            goToFace(i);
        };
        indicator.appendChild(dot);
    }
}

// Go to a specific face
function goToFace(faceIndex) {
    if (faceIndex < 0 || faceIndex >= fcTotalFaces) return;
    fcCurrentFace = faceIndex;
    updateCardFace();
}

// Update the card display based on current face
function updateCardFace() {
    const item = fcList[fcCurrentIndex];

    if (fcCurrentFace === 0) {
        // Face 0: Front (word only)
        fcCard.classList.remove('flipped');
        fcIsFlipped = false;
    } else {
        // Faces 1-3: Back (POS data)
        fcCard.classList.add('flipped');
        fcIsFlipped = true;

        let pos, meaning, example, example_ja;

        if (fcCurrentFace === 1) {
            pos = item.pos;
            meaning = item.meaning;
            example = item.example || '';
            example_ja = item.example_ja || '';
        } else if (fcCurrentFace === 2) {
            pos = item.pos2;
            meaning = item.meaning2;
            example = item.example2 || '';
            example_ja = item.example_ja2 || '';
        } else if (fcCurrentFace === 3) {
            pos = item.pos3;
            meaning = item.meaning3;
            example = item.example3 || '';
            example_ja = item.example_ja3 || '';
        }

        fcMeaning.innerHTML = `<span class="pos">${pos}</span> ${meaning}`;
        fcExample.textContent = example;
        fcExampleJa.textContent = example_ja;
    }

    // Update face indicator
    renderFaceIndicator();
}

function flipCard() {
    // Cycle through faces on tap
    fcCurrentFace = (fcCurrentFace + 1) % fcTotalFaces;
    updateCardFace();
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
        const isInReview = isWordInReviewList(item.word);
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
            <div class="example-ja-row">
                <span class="example-ja">${item.example_ja || ''}</span>
                <button class="review-btn ${isInReview ? 'active' : ''}" aria-label="Review">
                    <ion-icon name="${isInReview ? 'bookmark' : 'bookmark-outline'}"></ion-icon>
                </button>
            </div>
        `;

        // Add click listener for audio
        const audioBtn = div.querySelector('.audio-btn');
        audioBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering other clicks if any
            // speakWord(item.word); -> Replaced
            audioService.playAudio(item.word, currentVoiceURI);
        });

        // Add click listener for review button
        const reviewBtn = div.querySelector('.review-btn');
        reviewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isNowInReview = toggleReviewWord(item.word);
            reviewBtn.classList.toggle('active', isNowInReview);
            const icon = reviewBtn.querySelector('ion-icon');
            icon.name = isNowInReview ? 'bookmark' : 'bookmark-outline';

            // Update Start Review button count
            updateReviewStartBtn(words);
        });

        // Add click listener for row to start flashcards
        div.addEventListener('click', () => {
            startFlashCards(words, index);
        });

        wordListEl.appendChild(div);
    });
}

// Voice Settings
// We now support essentially two main high-quality voices + fallback
let currentVoiceURI = localStorage.getItem('voiceURI') || 'MALE'; // Default to MALE if not set

function populateVoiceList() {
    // Render to specialized containers
    renderVoiceSelector('voice-selector'); // Settings
    renderVoiceSelector('listening-voice-selector'); // Listening Mode
}

function renderVoiceSelector(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Define the options we want to show
    const options = [
        { id: 'MALE', label: 'Male (Pro)', icon: 'man-outline', color: '#6c5ce7' },
        { id: 'FEMALE', label: 'Female (Pro)', icon: 'woman-outline', color: '#ff7675' },
        // Standard Options for Background Audio Mixing
        { id: 'STANDARD_M', label: 'Male (Free)', icon: 'man', color: '#b2bec3' },
        { id: 'STANDARD_F', label: 'Female (Free)', icon: 'woman', color: '#b2bec3' }
    ];

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'voice-btn';
        if (currentVoiceURI === opt.id) {
            btn.classList.add('active');
        }

        btn.innerHTML = `
            <div class="voice-icon" style="color: ${opt.color}">
                <ion-icon name="${opt.icon}"></ion-icon>
            </div>
            <span class="voice-label">${opt.label}</span>
        `;

        btn.onclick = () => {
            currentVoiceURI = opt.id;
            localStorage.setItem('voiceURI', currentVoiceURI);

            // Update UI across all selectors
            document.querySelectorAll('.voice-btn').forEach(b => b.classList.remove('active'));
            // Re-render to ensure visual consistency easily
            populateVoiceList();

            // Feedback
            audioService.playAudio('Voice selected.', currentVoiceURI);
        };

        container.appendChild(btn);
    });
}

function updateActiveVoiceUI(uri) {
    populateVoiceList();
}

function speakWord(text) {
    // Delegate entirely to AudioService
    audioService.playAudio(text, currentVoiceURI);
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

// Settings Button Logic with State Preservation
settingsBtn.addEventListener('click', () => {
    const activeView = document.querySelector('.view.active');

    // If currently in settings, close it (toggle behavior)
    if (activeView && activeView.id === 'settings-view') {
        switchView(lastActiveView || 'list-view');
    } else {
        // Save current view and open settings
        if (activeView) {
            lastActiveView = activeView.id;
        }
        switchView('settings-view');
    }
});

closeSettingsBtn.addEventListener('click', () => {
    // Restore previous view
    switchView(lastActiveView);
});


// ===== WRITING MODE LOGIC =====

// Gemini API Service
class GeminiService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.models = [
            'gemini-1.5-flash',  // Primary - more stable for free tier
            'gemini-2.0-flash',  // Fallback
            'gemini-1.5-pro'     // Last resort
        ];
        this.currentModelIndex = 0;
    }

    getApiUrl(model) {
        return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    }

    async gradeEssay(essay, japaneseText, topic, retryCount = 0) {
        const prompt = this.buildPrompt(essay, japaneseText, topic);

        const requestBody = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4096,
            }
        };

        const model = this.models[this.currentModelIndex];
        const url = `${this.getApiUrl(model)}?key=${this.apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const error = await response.json();
                const errorMsg = error.error?.message || 'Gemini API request failed';

                // Check for rate limit error
                if (errorMsg.includes('quota') || errorMsg.includes('rate') || response.status === 429) {
                    // Try fallback model
                    if (this.currentModelIndex < this.models.length - 1) {
                        console.log(`Rate limit hit for ${model}, trying next model...`);
                        this.currentModelIndex++;
                        return this.gradeEssay(essay, japaneseText, topic, retryCount);
                    }

                    // Extract retry time if available
                    const retryMatch = errorMsg.match(/retry in (\d+\.?\d*)/i);
                    const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;

                    throw new Error(`APIの利用制限に達しました。${retrySeconds}秒後に再試行してください。`);
                }

                throw new Error(errorMsg);
            }

            const data = await response.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!textContent) {
                throw new Error('No response from Gemini');
            }

            // Reset to primary model on success
            this.currentModelIndex = 0;
            return this.parseResponse(textContent);

        } catch (error) {
            // If it's a network error and we haven't tried all models, try next
            if (error.name === 'TypeError' && this.currentModelIndex < this.models.length - 1) {
                this.currentModelIndex++;
                return this.gradeEssay(essay, japaneseText, topic, retryCount);
            }
            throw error;
        }
    }

    buildPrompt(essay, japaneseText, topic) {
        const topicSection = topic ? `
[ESSAY TOPIC/QUESTION]
${topic}

` : '';

        const japaneseSection = japaneseText ? `
[JAPANESE TRANSLATION - For reference to understand user's intent]
${japaneseText}

` : '';

        return `You are an extremely strict TOEFL iBT Writing examiner. Your goal is to help students achieve a perfect score, so you must grade with extreme rigor. Only give high scores for near-perfect writing.

${topicSection}[ENGLISH ESSAY TO GRADE]
${essay}

${japaneseSection}[SCORING RUBRIC - TOEFL Independent Writing (0-5 per category)]

1. **Organization** (0-5): Clear thesis, logical structure, smooth paragraph transitions
2. **Development** (0-5): Depth of ideas, specific examples, thorough explanations
3. **Grammar** (0-5): Grammatical accuracy, sentence variety, no errors
4. **Vocabulary** (0-5): Range, precision, academic word choice, natural collocations
5. **Coherence** (0-5): Use of transitions, paragraph unity, logical flow

Total Score = Sum of all categories × 1.2 (max 30)

[GRADING GUIDELINES - BE HARSH]
- 5: Near-perfect, native-level proficiency
- 4: Good but with minor issues
- 3: Adequate but noticeable weaknesses
- 2: Significant problems affecting comprehension
- 1: Major issues throughout
- 0: Incomprehensible or off-topic

[OUTPUT FORMAT]
Return ONLY valid JSON (no markdown code blocks, no explanation before/after):
{
    "totalScore": <number 0-30>,
    "breakdown": {
        "organization": { "score": <0-5>, "comment": "日本語で具体的なフィードバック" },
        "development": { "score": <0-5>, "comment": "日本語で具体的なフィードバック" },
        "grammar": { "score": <0-5>, "comment": "日本語で具体的なフィードバック" },
        "vocabulary": { "score": <0-5>, "comment": "日本語で具体的なフィードバック" },
        "coherence": { "score": <0-5>, "comment": "日本語で具体的なフィードバック" }
    },
    "overallComment": "日本語での総評（厳しめに、改善点を明確に指摘）",
    "corrections": [
        { "original": "元の表現", "corrected": "修正後の表現", "reason": "日本語で理由を説明" }
    ],
    "modelAnswer": "A well-structured model essay in English demonstrating the ideal response (約200-300 words)",
    "keyPhrases": ["useful phrase 1", "useful phrase 2", "useful phrase 3", "useful phrase 4", "useful phrase 5"]
}`;
    }

    parseResponse(text) {
        // Try to extract JSON from the response
        let jsonStr = text.trim();

        // Remove markdown code blocks if present
        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.slice(7);
        } else if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.slice(3);
        }
        if (jsonStr.endsWith('```')) {
            jsonStr = jsonStr.slice(0, -3);
        }
        jsonStr = jsonStr.trim();

        try {
            const result = JSON.parse(jsonStr);

            // Validate required fields
            if (typeof result.totalScore !== 'number') {
                throw new Error('Invalid totalScore');
            }

            return result;
        } catch (e) {
            console.error('Failed to parse Gemini response:', e, text);
            throw new Error('採点結果の解析に失敗しました。もう一度お試しください。');
        }
    }
}

// Writing Mode State
let writingHistory = JSON.parse(localStorage.getItem('writingHistory') || '[]');
let currentGradingResult = null;
let geminiService = null;

// Initialize Gemini Service
if (CONFIG.GEMINI_API_KEY) {
    geminiService = new GeminiService(CONFIG.GEMINI_API_KEY);
}

// Writing Mode Elements
const writingInputContainer = document.getElementById('writing-input-container');
const writingHistoryContainer = document.getElementById('writing-history-container');
const writingLoadingContainer = document.getElementById('writing-loading-container');
const writingResultContainer = document.getElementById('writing-result-container');

const writingTopicInput = document.getElementById('writing-topic-input');
const writingEnglishInput = document.getElementById('writing-english-input');
const writingJapaneseInput = document.getElementById('writing-japanese-input');
const writingJapaneseToggle = document.getElementById('writing-japanese-toggle');
const writingUsageDisplay = document.getElementById('writing-usage-display');
const writingGradeBtn = document.getElementById('writing-grade-btn');

const writingHistoryBtn = document.getElementById('writing-history-btn');
const writingHistoryBackBtn = document.getElementById('writing-history-back-btn');
const writingHistoryList = document.getElementById('writing-history-list');

const writingResultBackBtn = document.getElementById('writing-result-back-btn');
const writingSaveBtn = document.getElementById('writing-save-btn');
const writingRetryBtn = document.getElementById('writing-retry-btn');

// Rate Limiting
function getWritingUsage() {
    const today = new Date().toISOString().split('T')[0];
    const usage = JSON.parse(localStorage.getItem('writingDailyUsage') || '{}');

    if (usage.date !== today) {
        return { date: today, count: 0 };
    }
    return usage;
}

function incrementWritingUsage() {
    const usage = getWritingUsage();
    usage.count++;
    localStorage.setItem('writingDailyUsage', JSON.stringify(usage));
    updateUsageDisplay();
}

function updateUsageDisplay() {
    const usage = getWritingUsage();
    if (writingUsageDisplay) {
        writingUsageDisplay.textContent = `Today: ${usage.count}/10 uses`;
    }
}

function canUseWritingAPI() {
    const usage = getWritingUsage();
    return usage.count < 10;
}

// Screen Navigation
function showWritingScreen(screenName) {
    writingInputContainer.classList.add('hidden');
    writingHistoryContainer.classList.add('hidden');
    writingLoadingContainer.classList.add('hidden');
    writingResultContainer.classList.add('hidden');

    switch (screenName) {
        case 'input':
            writingInputContainer.classList.remove('hidden');
            updateUsageDisplay();
            break;
        case 'history':
            writingHistoryContainer.classList.remove('hidden');
            renderWritingHistory();
            break;
        case 'loading':
            writingLoadingContainer.classList.remove('hidden');
            break;
        case 'result':
            writingResultContainer.classList.remove('hidden');
            break;
    }
}

// History Management
function saveToWritingHistory(result, essayData) {
    const historyItem = {
        id: Date.now(),
        date: new Date().toISOString(),
        topic: essayData.topic,
        essay: essayData.essay,
        japanese: essayData.japanese,
        result: result
    };

    writingHistory.unshift(historyItem);

    // Limit to 10 items
    if (writingHistory.length > 10) {
        writingHistory = writingHistory.slice(0, 10);
    }

    localStorage.setItem('writingHistory', JSON.stringify(writingHistory));
}

function deleteFromWritingHistory(id) {
    writingHistory = writingHistory.filter(item => item.id !== id);
    localStorage.setItem('writingHistory', JSON.stringify(writingHistory));
    renderWritingHistory();
}

function renderWritingHistory() {
    if (!writingHistoryList) return;

    if (writingHistory.length === 0) {
        writingHistoryList.innerHTML = `
            <div class="template-empty">
                <ion-icon name="document-text-outline"></ion-icon>
                <p>No grading history yet.<br>Grade an essay to see results here!</p>
            </div>
        `;
        return;
    }

    writingHistoryList.innerHTML = writingHistory.map(item => {
        const date = new Date(item.date);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        const preview = item.essay.substring(0, 50) + (item.essay.length > 50 ? '...' : '');

        return `
            <div class="history-item" data-id="${item.id}">
                <div class="history-item-header">
                    <span class="history-item-score">${item.result.totalScore}/30</span>
                    <span class="history-item-date">${dateStr}</span>
                </div>
                <div class="history-item-preview">${escapeHtml(preview)}</div>
                <div class="history-item-actions">
                    <button class="history-delete-btn" data-id="${item.id}">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    writingHistoryList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.history-delete-btn')) return;

            const id = parseInt(item.dataset.id);
            const historyItem = writingHistory.find(h => h.id === id);
            if (historyItem) {
                currentGradingResult = historyItem.result;
                displayGradingResult(historyItem.result);
                showWritingScreen('result');
            }
        });
    });

    writingHistoryList.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            if (confirm('この履歴を削除しますか？')) {
                deleteFromWritingHistory(id);
            }
        });
    });
}

// Display Grading Result
function displayGradingResult(result) {
    // Total Score
    const totalScoreEl = document.getElementById('result-total-score');
    if (totalScoreEl) {
        totalScoreEl.textContent = result.totalScore;
    }

    // Breakdown
    const breakdownEl = document.getElementById('result-breakdown');
    if (breakdownEl && result.breakdown) {
        const categories = [
            { key: 'organization', label: 'Organization' },
            { key: 'development', label: 'Development' },
            { key: 'grammar', label: 'Grammar' },
            { key: 'vocabulary', label: 'Vocabulary' },
            { key: 'coherence', label: 'Coherence' }
        ];

        breakdownEl.innerHTML = categories.map(cat => {
            const data = result.breakdown[cat.key] || { score: 0, comment: '' };
            const percentage = (data.score / 5) * 100;

            return `
                <div class="breakdown-item">
                    <span class="breakdown-label">${cat.label}</span>
                    <div class="breakdown-bar">
                        <div class="breakdown-fill" style="width: ${percentage}%"></div>
                    </div>
                    <span class="breakdown-score">${data.score}/5</span>
                </div>
                <div class="breakdown-comment" style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.8rem; padding-left: 0.5rem;">
                    ${escapeHtml(data.comment || '')}
                </div>
            `;
        }).join('');
    }

    // Overall Comment
    const commentEl = document.getElementById('result-comment');
    if (commentEl) {
        commentEl.textContent = result.overallComment || '';
    }

    // Corrections
    const correctionsEl = document.getElementById('result-corrections');
    if (correctionsEl && result.corrections) {
        if (result.corrections.length === 0) {
            correctionsEl.innerHTML = '<p style="color: var(--text-secondary);">修正箇所はありません。</p>';
        } else {
            correctionsEl.innerHTML = result.corrections.map(c => `
                <div class="correction-item">
                    <div class="correction-original">${escapeHtml(c.original)}</div>
                    <div class="correction-corrected">→ ${escapeHtml(c.corrected)}</div>
                    <div class="correction-reason">${escapeHtml(c.reason)}</div>
                </div>
            `).join('');
        }
    }

    // Model Answer
    const modelAnswerEl = document.getElementById('result-model-answer');
    if (modelAnswerEl) {
        modelAnswerEl.textContent = result.modelAnswer || '';
    }

    // Key Phrases
    const keyPhrasesEl = document.getElementById('result-key-phrases');
    if (keyPhrasesEl && result.keyPhrases) {
        keyPhrasesEl.innerHTML = result.keyPhrases.map(phrase =>
            `<span class="key-phrase">${escapeHtml(phrase)}</span>`
        ).join('');
    }
}

// Submit for Grading
async function submitForGrading() {
    const topic = writingTopicInput?.value.trim() || '';
    const essay = writingEnglishInput?.value.trim() || '';
    const japanese = writingJapaneseInput?.value.trim() || '';
    const isJapaneseRequired = writingJapaneseToggle?.checked ?? true;

    // Validation
    if (!essay) {
        alert('英語のエッセイを入力してください。');
        return;
    }

    if (isJapaneseRequired && !japanese) {
        alert('日本語訳を入力してください。（任意にする場合はトグルをオフにしてください）');
        return;
    }

    if (!canUseWritingAPI()) {
        alert('本日の利用回数（10回）に達しました。明日またお試しください。');
        return;
    }

    if (!geminiService) {
        alert('Gemini APIキーが設定されていません。config.jsを確認してください。');
        return;
    }

    // Show loading
    showWritingScreen('loading');

    try {
        const result = await geminiService.gradeEssay(essay, japanese, topic);
        currentGradingResult = result;

        // Store essay data for potential saving
        currentGradingResult._essayData = { topic, essay, japanese };

        incrementWritingUsage();
        displayGradingResult(result);
        showWritingScreen('result');
    } catch (error) {
        console.error('Grading error:', error);
        alert('採点中にエラーが発生しました: ' + error.message);
        showWritingScreen('input');
    }
}

// Event Listeners for Writing Mode
if (writingGradeBtn) {
    writingGradeBtn.addEventListener('click', submitForGrading);
}

if (writingHistoryBtn) {
    writingHistoryBtn.addEventListener('click', () => {
        showWritingScreen('history');
    });
}

if (writingHistoryBackBtn) {
    writingHistoryBackBtn.addEventListener('click', () => {
        showWritingScreen('input');
    });
}

if (writingResultBackBtn) {
    writingResultBackBtn.addEventListener('click', () => {
        showWritingScreen('input');
    });
}

if (writingSaveBtn) {
    writingSaveBtn.addEventListener('click', () => {
        if (currentGradingResult && currentGradingResult._essayData) {
            saveToWritingHistory(currentGradingResult, currentGradingResult._essayData);
            alert('採点結果を保存しました。');
            writingSaveBtn.disabled = true;
            writingSaveBtn.innerHTML = '<ion-icon name="checkmark-outline"></ion-icon> Saved';
        }
    });
}

if (writingRetryBtn) {
    writingRetryBtn.addEventListener('click', () => {
        currentGradingResult = null;
        writingSaveBtn.disabled = false;
        writingSaveBtn.innerHTML = '<ion-icon name="bookmark-outline"></ion-icon> Save Result';
        showWritingScreen('input');
    });
}

// Japanese Toggle Label Update
if (writingJapaneseToggle) {
    const toggleLabel = writingJapaneseToggle.parentElement.querySelector('.toggle-label');
    writingJapaneseToggle.addEventListener('change', () => {
        if (toggleLabel) {
            toggleLabel.textContent = writingJapaneseToggle.checked ? 'Required' : 'Optional';
        }
    });
}

// Initialize Writing Mode when view is shown
function initWritingMode() {
    showWritingScreen('input');
    updateUsageDisplay();

    // Reset save button state
    if (writingSaveBtn) {
        writingSaveBtn.disabled = false;
        writingSaveBtn.innerHTML = '<ion-icon name="bookmark-outline"></ion-icon> Save Result';
    }
}

// Update navigation to initialize Writing Mode
const originalSwitchView = switchView;
switchView = function (viewId) {
    originalSwitchView(viewId);
    if (viewId === 'writing-view') {
        initWritingMode();
    }
};
