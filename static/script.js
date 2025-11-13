(() => {
  // 正则表达式常量
  const LINE_RE = /\[(\d+:\d+\.\d+)\](.*)/;
  const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/;
  const INFO_RE = {
    album: /\[al:(.*)\]/,
    artist: /\[ar:(.*)\]/,
    title: /\[ti:(.*)\]/,
    by: /\[by:(.*)\]/
  };

  // DOM元素引用
  const DOM = {
    audio: document.getElementById('player'),
    content: document.getElementById('content'),
    playPauseButton: document.getElementById('play-pause-button'),
    translateButton: document.getElementById('translate-button'),
    bookSelector: document.getElementById('book-selector'),
    closeSelectorButton: document.getElementById('close-selector'),
    lessonList: document.getElementById('lesson-list'),
    selectorTitle: document.getElementById('selector-title'),
    bookCoverImg: document.getElementById('book-cover-img'),
    bookLinks: document.querySelectorAll('nav a[data-book]'),
    songTitle: document.getElementById('song-title'),
    songArtist: document.getElementById('song-artist'),
    nowPlaying: document.getElementById('now-playing'),
    prevButton: document.getElementById('prev-button'),
    nextButton: document.getElementById('next-button')
  };

  // 应用状态管理
  const state = {
    data: [],                    // 存储解析后的LRC歌词数据，包含英文、中文、开始时间和结束时间
    album: '',                   // 专辑名称（从LRC文件中解析）
    artist: '',                  // 艺术家/作者信息（从LRC文件中解析）
    title: '',                   // 歌曲/课程标题（从LRC文件中解析）
    by: '',                      // 制作人信息（从LRC文件中解析）
    segmentEnd: 0,               // 当前播放片段的结束时间（秒）
    activeIdx: -1,               // 当前高亮显示的句子索引，-1表示无高亮
    isPlaying: false,            // 音频播放状态标识
    currentTime: 0,              // 音频当前播放时间（秒）
    duration: 0,                 // 音频总时长（秒）
    showTranslation: false,      // 是否显示中文翻译的标识
    currentBook: 'NCE1',         // 当前选择的课本（默认为NCE1）
    currentLesson: null,         // 当前选择的课程文件名
    lessons: [],                 // 当前课本的所有课程列表
    currentLessonTitle: '',      // 当前课程的标题
    currentSentenceIndex: -1,    // 当前播放句子的索引，-1表示未开始播放
    chineseElements: [],         // 缓存的中文元素列表，用于快速切换显示/隐藏
    lastPlayedLesson: null       // 上次播放的课程信息
  };

  // 获取当前课本名称
  const bookTitles = {
    'NCE1': '新概念英语-第一册',
    'NCE2': '新概念英语-第二册',
    'NCE3': '新概念英语-第三册',
    'NCE4': '新概念英语-第四册'
  };

  // 安全的DOM元素操作函数
  function safeSetContent(element, content) {
    if (element) {
      element.textContent = content;
    }
  }

  function safeSetHTML(element, html) {
    if (element) {
      element.innerHTML = html;
    }
  }

  function safeAddClass(element, className) {
    if (element && className) {
      element.classList.add(className);
    }
  }

  function safeRemoveClass(element, className) {
    if (element && className) {
      element.classList.remove(className);
    }
  }

  function safeToggleClass(element, className) {
    if (element && className) {
      element.classList.toggle(className);
    }
  }

  // 课程信息保存和恢复函数
  function saveLastPlayedLesson() {
    if (!state.currentBook || !state.currentLesson) {
      return;
    }

    const lessonData = {
      book: state.currentBook,
      lesson: state.currentLesson,
      lessonTitle: state.currentLessonTitle,
      timestamp: Date.now()
    };

    try {
      localStorage.setItem('nceLastPlayedLesson', JSON.stringify(lessonData));
    } catch (e) {
      console.error('保存课程信息失败:', e);
    }
  }

  function loadLastPlayedLesson() {
    try {
      const savedData = localStorage.getItem('nceLastPlayedLesson');
      if (savedData) {
        const lessonData = JSON.parse(savedData);
        // 检查数据是否有效且不超过24小时
        if (lessonData && 
            lessonData.book && 
            lessonData.lesson && 
            (Date.now() - lessonData.timestamp < 24 * 60 * 60 * 1000)) {
          return lessonData;
        } else {
          // 数据过期或无效，清除
          localStorage.removeItem('nceLastPlayedLesson');
        }
      }
    } catch (e) {
      console.error('加载课程信息失败:', e);
      localStorage.removeItem('nceLastPlayedLesson');
    }
    return null;
  }

  // 音频控制函数
  function playSegment(start, end) {
    if (!DOM.audio || !DOM.playPauseButton) return;
    
    state.segmentEnd = end;
    DOM.audio.currentTime = start;
    DOM.audio.play();
    state.isPlaying = true;
    DOM.playPauseButton.textContent = '⏸';
    
    // 查找并高亮对应的句子
    const idx = state.data.findIndex(item => item.start === start);
    if (idx !== -1) {
      highlightSentenceForce(idx);
    }
  }

  function togglePlayPause() {
    if (!DOM.audio || !DOM.playPauseButton) return;
    
    if (state.isPlaying) {
      DOM.audio.pause();
      state.isPlaying = false;
      DOM.playPauseButton.textContent = '▶';
    } else {
      if (state.data.length > 0) {
        // 如果没有正在播放的句子，播放第一个句子
        if (state.currentSentenceIndex === -1) {
          const {start, end} = state.data[0];
          playSegment(start, end);
          state.currentSentenceIndex = 0;
        } else {
          DOM.audio.play();
          state.isPlaying = true;
          DOM.playPauseButton.textContent = '⏸';
          // 确保当前句子高亮
          if (state.currentSentenceIndex !== -1) {
            highlightSentenceForce(state.currentSentenceIndex);
          }
        }
      }
    }
  }

  function playPrevSentence() {
    if (state.data.length === 0) return;
    
    if (state.currentSentenceIndex > 0) {
      state.currentSentenceIndex--;
    } else {
      state.currentSentenceIndex = state.data.length - 1;
    }
    
    const {start, end} = state.data[state.currentSentenceIndex];
    playSegment(start, end);
  }

  function playNextSentence() {
    if (state.data.length === 0) return;
    
    if (state.currentSentenceIndex < state.data.length - 1) {
      state.currentSentenceIndex++;
    } else {
      state.currentSentenceIndex = 0;
    }
    
    const {start, end} = state.data[state.currentSentenceIndex];
    playSegment(start, end);
  }

  // 句子高亮显示
  function highlightSentence(idx) {
    // 边界检查和重复检查
    if (idx === state.activeIdx || !DOM.content) return;
    
    // 只有在播放状态下才高亮显示句子
    if (!state.isPlaying) return;
    
    const prev = DOM.content.querySelector('.content-item.active');
    if (prev) safeRemoveClass(prev, 'active');
    
    const cur = DOM.content.querySelector(`.content-item[data-idx="${idx}"]`);
    if (cur) {
      safeAddClass(cur, 'active');
      // 滚动到当前高亮句子，确保它在视口中可见
      cur.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
    
    state.activeIdx = idx;
    state.currentSentenceIndex = idx;
  }
  
  // 强制高亮句子（忽略重复检查）
  function highlightSentenceForce(idx) {
    // 边界检查
    if (idx < 0 || idx >= state.data.length || !DOM.content) return;
    
    const prev = DOM.content.querySelector('.content-item.active');
    if (prev) safeRemoveClass(prev, 'active');
    
    const cur = DOM.content.querySelector(`.content-item[data-idx="${idx}"]`);
    if (cur) {
      safeAddClass(cur, 'active');
      // 滚动到当前高亮句子，确保它在视口中可见
      cur.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
    
    state.activeIdx = idx;
    state.currentSentenceIndex = idx;
  }
  
  // 清除所有高亮
  function clearHighlight() {
    if (!DOM.content) return;
    
    const activeItems = DOM.content.querySelectorAll('.content-item.active');
    activeItems.forEach(item => {
      safeRemoveClass(item, 'active');
    });
    
    state.activeIdx = -1;
    state.currentSentenceIndex = -1;
  }

  // 内容渲染
  function renderContent() {
    if (!DOM.content || !DOM.nowPlaying) return;
    
    const currentBookTitle = bookTitles[state.currentBook] || '新概念英语';
    
    // 查找当前课程编号
    let lessonNumber = '';
    if (state.lessons && state.currentLesson) {
      const lessonIndex = state.lessons.findIndex(lesson => lesson.filename === state.currentLesson);
      if (lessonIndex !== -1) {
        lessonNumber = `第${lessonIndex + 1}课 `;
      }
    }
    
    // 构造完整的标题
    const fullTitle = `${lessonNumber}${state.currentLessonTitle}`;
    
    if (state.data.length === 0) {
      safeSetHTML(DOM.content, `
        <div class="header">
          <h1>${currentBookTitle}</h1>
          <div class="now-playing">暂无播放</div>
        </div>
        <div class="content-item">
          <div class="english">暂无内容</div>
          <div class="chinese">请选择课程开始学习</div>
        </div>`);
      return;
    }
    
    let contentHTML = `
      <div class="header">
        <h1>${currentBookTitle}</h1>
        <div class="now-playing">${fullTitle}</div>
      </div>`;
    
    contentHTML += state.data.map(
      (item, idx) =>
        `<div class="content-item" data-idx="${idx}" data-start="${item.start}" data-end="${item.end}">
          <div class="english">${item.en}</div>
          <div class="chinese ${!state.showTranslation ? 'hidden' : ''}">${item.cn}</div>
        </div>`
    ).join('');
    
    safeSetHTML(DOM.content, contentHTML);
    
    // 更新中文元素缓存
    state.chineseElements = Array.from(document.querySelectorAll('.chinese'));
    
    // 确保渲染后没有高亮行
    clearHighlight();
  }

  // LRC文件解析函数
  function parseInfo(line) {
    for (const key in INFO_RE) {
      const m = line.match(INFO_RE[key]);
      if (m) state[key] = m[1];
    }
  }

  function parseTime(tag) {
    const m = TIME_RE.exec(tag);
    return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) - 0.5 : 0;
  }

  // 加载LRC文件
  async function loadLrc(filename) {
    try {
      // 安全检查
      if (!state.currentBook || !filename) {
        throw new Error('缺少必要参数');
      }
      
      const lrcSrc = `${state.currentBook}/${filename}.lrc`;
      const response = await fetch(lrcSrc);
      
      if (!response.ok) {
        throw new Error(`无法加载文件: ${lrcSrc}`);
      }
      
      const text = await response.text();
      const lines = text.split(/\r?\n/).filter(Boolean);

      state.data = [];
      
      lines.forEach((raw, i) => {
        const line = raw.trim();
        const match = line.match(LINE_RE);
        if (!match) {
          parseInfo(line);
          return;
        }

        const start = parseTime(`[${match[1]}]`);
        const [en, cn = ''] = match[2].split('|').map(s => s.trim());

        let end = 0;
        for (let j = i + 1; j < lines.length; j++) {
          const nxt = lines[j].match(LINE_RE);
          if (nxt) {
            end = parseTime(`[${nxt[1]}]`);
            break;
          }
        }
        state.data.push({en, cn, start, end});
      });

      // 设置音频源
      if (DOM.audio) {
        const mp3Src = `${state.currentBook}/${filename}.mp3`;
        DOM.audio.src = mp3Src;
      }
      
      // 更新UI信息
      safeSetContent(DOM.songTitle, state.title || '未知标题');
      safeSetContent(DOM.songArtist, state.artist || '未知作者');
      
      // 重置状态
      state.currentSentenceIndex = -1;
      state.activeIdx = -1;
      
      // 清除可能存在的高亮
      clearHighlight();
      
      renderContent();
    } catch (error) {
      console.error('加载LRC文件失败:', error);
      if (DOM.content) {
        const currentBookTitle = bookTitles[state.currentBook] || '新概念英语';
        
        safeSetHTML(DOM.content, `
          <div class="header">
            <h1>${currentBookTitle}</h1>
            <div class="now-playing">暂无播放</div>
          </div>
          <div class="content-item error">
            <div class="english">加载课程失败</div>
            <div class="chinese">${error.message}</div>
          </div>`);
      }
    }
  }

  // 课程选择功能
  function showBookSelector(book) {
    state.currentBook = 'NCE' + book;
    safeSetContent(DOM.selectorTitle, `选择NCE${book}课程`);
    if (DOM.bookSelector) {
      safeAddClass(DOM.bookSelector, 'active');
    }
    loadLessonList(book);
  }

  async function loadLessonList(book) {
    if (!DOM.lessonList) return;
    
    safeSetHTML(DOM.lessonList, '<div class="loading">加载中...</div>');
    
    try {
      const response = await fetch('static/data.json');
      const allLessons = await response.json();
      
      const bookKey = book;
      const lessons = allLessons[bookKey] || [];
      state.lessons = lessons;
      
      const lessonsHTML = lessons.map((lesson, index) => {
        const lessonTitle = lesson.title;
        const lessonNumber = index + 1;
        return `<div class="lesson-item" data-lesson="${lesson.filename}">第${lessonNumber}课 ${lessonTitle}</div>`;
      }).join('');
      
      safeSetHTML(DOM.lessonList, lessonsHTML);
      
      if (lessons.length === 0) {
        safeSetHTML(DOM.lessonList, '<div class="error">该课本暂无课程</div>');
      }
      
      // 如果有上次播放的课程信息且与当前课本匹配，需要重新渲染内容以显示正确的课程编号
      if (state.lastPlayedLesson && state.lastPlayedLesson.book === state.currentBook) {
        renderContent();
        // 确保在重新渲染后没有意外的高亮
        clearHighlight();
      }
    } catch (error) {
      console.error('加载课程列表失败:', error);
      safeSetHTML(DOM.lessonList, '<div class="error">加载课程列表失败</div>');
    }
  }

  function selectLesson(lessonName) {
    // 查找课程标题
    const lesson = state.lessons.find(l => l.filename === lessonName);
    state.currentLessonTitle = lesson ? lesson.title : lessonName;
    
    state.currentLesson = lessonName;
    loadLrc(lessonName);
    if (DOM.bookSelector) {
      safeRemoveClass(DOM.bookSelector, 'active');
    }
    
    const bookNumber = state.currentBook.replace('NCE', '');
    if (DOM.bookCoverImg) {
      DOM.bookCoverImg.src = `images/NCE${bookNumber}.jpg`;
    }
    
    // 保存播放的课程信息
    saveLastPlayedLesson();
    
    // 确保选择新课程后没有高亮行
    clearHighlight();
  }

  // 事件监听器
  function setupEventListeners() {
    // 音频时间更新事件
    if (DOM.audio) {
      DOM.audio.addEventListener('timeupdate', () => {
        state.currentTime = DOM.audio.currentTime;
        
        // 检查是否到达当前片段末尾
        if (state.segmentEnd && state.currentTime >= state.segmentEnd) {
          // 自动播放下一个句子
          if (state.currentSentenceIndex < state.data.length - 1) {
            state.currentSentenceIndex++;
            const nextItem = state.data[state.currentSentenceIndex];
            state.segmentEnd = nextItem.end;
            highlightSentence(state.currentSentenceIndex);
          } else {
            // 播放完成
            DOM.audio.pause();
            state.isPlaying = false;
            if (DOM.playPauseButton) DOM.playPauseButton.textContent = '▶';
            state.segmentEnd = 0;
          }
          return;
        }
        
        // 根据当前时间自动高亮句子
        if (state.data.length > 0) {
          const idx = state.data.findIndex(
            item => state.currentTime >= item.start && state.currentTime < item.end
          );
          
          if (idx !== -1 && idx !== state.activeIdx) {
            highlightSentence(idx);
          }
        }
      });
      
      DOM.audio.addEventListener('loadedmetadata', () => {
        state.duration = DOM.audio.duration;
      });
      
      DOM.audio.addEventListener('ended', () => {
        state.isPlaying = false;
        if (DOM.playPauseButton) DOM.playPauseButton.textContent = '▶';
      });
      
      DOM.audio.addEventListener('error', (e) => {
        console.error('音频加载失败:', e);
        if (DOM.content) {
          const currentBookTitle = bookTitles[state.currentBook] || '新概念英语';
          
          safeSetHTML(DOM.content, `
            <div class="header">
              <h1>${currentBookTitle}</h1>
              <div class="now-playing">暂无播放</div>
            </div>
            <div class="content-item error">
              <div class="english">音频加载失败</div>
              <div class="chinese">请检查网络连接或稍后重试</div>
            </div>`);
        }
      });
    }
    
    // 播放/暂停按钮事件
    if (DOM.playPauseButton) {
      DOM.playPauseButton.addEventListener('click', togglePlayPause);
    }
    
    // 上一句/下一句按钮事件
    if (DOM.prevButton) {
      DOM.prevButton.addEventListener('click', playPrevSentence);
    }
    
    if (DOM.nextButton) {
      DOM.nextButton.addEventListener('click', playNextSentence);
    }
    
    // 内容区域点击事件
    if (DOM.content) {
      DOM.content.addEventListener('click', e => {
        const target = e.target.closest('.content-item');
        if (!target) return;
        
        const idx = Number(target.dataset.idx);
        if (isNaN(idx) || idx < 0 || idx >= state.data.length) return;
        
        // 点击后从该句子开始连续播放
        state.currentSentenceIndex = idx;
        const {start, end} = state.data[idx];
        playSegment(start, end);
        
        // 设置segmentEnd以便后续自动播放
        state.segmentEnd = end;
      });
    }
    
    // 翻译显示切换事件
    if (DOM.translateButton) {
      DOM.translateButton.addEventListener('click', () => {
        safeToggleClass(DOM.translateButton, 'active');
        state.showTranslation = DOM.translateButton.classList.contains('active');
        
        // 使用缓存的元素而不是每次都查询
        state.chineseElements.forEach(el => {
          if (state.showTranslation) {
            el.classList.remove('hidden');
          } else {
            el.classList.add('hidden');
          }
        });
      });
    }
    
    // 课本选择链接事件
    if (DOM.bookLinks) {
      DOM.bookLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const book = link.dataset.book;
          if (book) {
            showBookSelector(book);
          }
        });
      });
    }
    
    // 关闭选择器按钮事件
    if (DOM.closeSelectorButton) {
      DOM.closeSelectorButton.addEventListener('click', () => {
        if (DOM.bookSelector) {
          safeRemoveClass(DOM.bookSelector, 'active');
        }
      });
    }
    
    // 点击选择器外部区域关闭选择器
    if (DOM.bookSelector) {
      DOM.bookSelector.addEventListener('click', (e) => {
        // 如果点击的是.book-selector元素自身（即遮罩层），则关闭选择器
        if (e.target === DOM.bookSelector) {
          safeRemoveClass(DOM.bookSelector, 'active');
        }
      });
    }
    
    // 课程列表点击事件
    if (DOM.lessonList) {
      DOM.lessonList.addEventListener('click', e => {
        const target = e.target.closest('.lesson-item');
        if (!target) return;
        
        const lessonName = target.dataset.lesson;
        if (lessonName) {
          selectLesson(lessonName);
        }
      });
    }
    
    // 页面卸载前保存播放课程信息
    window.addEventListener('beforeunload', () => {
      saveLastPlayedLesson();
    });
  }

  // 初始化应用
  function initApp() {
    // 加载上次播放的课程信息
    state.lastPlayedLesson = loadLastPlayedLesson();
    
    // 如果有保存的课程信息，使用它来设置初始状态
    if (state.lastPlayedLesson) {
      state.currentBook = state.lastPlayedLesson.book;
      state.currentLesson = state.lastPlayedLesson.lesson;
      state.currentLessonTitle = state.lastPlayedLesson.lessonTitle || '第1课 Excuse Me';
      
      if (DOM.bookCoverImg) {
        const bookNumber = state.currentBook.replace('NCE', '');
        DOM.bookCoverImg.src = `images/NCE${bookNumber}.jpg`;
      }
      
      // 预加载课程列表以确保能正确显示课程编号
      loadLessonList(state.currentBook.replace('NCE', ''));
    } else {
      // 设置默认初始状态
      state.currentBook = 'NCE1';
      state.currentLesson = '001&002－Excuse Me';
      state.currentLessonTitle = '第1课 Excuse Me';
      
      if (DOM.bookCoverImg) {
        DOM.bookCoverImg.src = 'images/NCE1.jpg';
      }
    }
    
    // 加载课程
    loadLrc(state.currentLesson);
    // 确保初始加载后没有高亮行
    clearHighlight();
  }

  // DOM内容加载完成后初始化
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initApp();
  });
  
  // 键盘快捷键支持
  document.addEventListener('keydown', (e) => {
    // 防止在输入框中触发快捷键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    
    // 空格键控制播放/暂停
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    }
    
    // 左箭头键控制上一句
    if (e.code === 'ArrowLeft') {
      playPrevSentence();
    }
    
    // 右箭头键控制下一句
    if (e.code === 'ArrowRight') {
      playNextSentence();
    }
  });
})();