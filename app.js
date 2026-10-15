// ==========================================
// 🚀 全局配置与环境嗅探
// ==========================================
// 核心嗅探：判断当前是否运行在 Chrome 扩展环境中
const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

let globalSources = [];
let localCache = {}; 
let updateTimesCache = {}; 
let globalDisplayLimit = 1; 
let githubConfig = { token: '', repo: '', path: 'news_data.json' }; // 存储 GitHub 账户配置

// ==========================================
// 💾 数据存储适配器 (自动兼容扩展与网页)
// ==========================================
const AppStorage = {
    async get(keys) {
        if (isExtension) {
            return new Promise(resolve => chrome.storage.local.get(keys, resolve));
        } else {
            let res = {};
            keys.forEach(k => {
                let val = localStorage.getItem(k);
                if (val !== null) {
                    try { res[k] = JSON.parse(val); } catch (e) { res[k] = val; }
                }
            });
            return res;
        }
    },
    async set(data) {
        if (isExtension) {
            return new Promise(resolve => chrome.storage.local.set(data, resolve));
        } else {
            for (let k in data) {
                localStorage.setItem(k, JSON.stringify(data[k]));
            }
            return Promise.resolve();
        }
    },
    async remove(keys) {
        if (isExtension) {
            return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
        } else {
            keys.forEach(k => localStorage.removeItem(k));
            return Promise.resolve();
        }
    }
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  
  try {
    const sourcesUrl = isExtension ? chrome.runtime.getURL('sources.json') : 'sources.json';
    const response = await fetch(sourcesUrl);
    const defaultSources = await response.json();
    
    // 读取持久化配置
    const result = await AppStorage.get(['customSources', 'mathNewsCache', 'updateTimesCache', 'displayLimit', 'githubConfig']);
    
    if (result.customSources && result.customSources.length > 0) globalSources = result.customSources;
    else globalSources = defaultSources;

    if (result.updateTimesCache) updateTimesCache = result.updateTimesCache;
    if (result.githubConfig) {
        githubConfig = result.githubConfig;
        document.getElementById('gh-token').value = githubConfig.token || '';
        document.getElementById('gh-repo').value = githubConfig.repo || '';
        document.getElementById('gh-path').value = githubConfig.path || 'news_data.json';
    }
    
    globalDisplayLimit = result.displayLimit !== undefined ? result.displayLimit : 1;
    document.getElementById('global-display-limit').value = globalDisplayLimit;

    // 🔥 核心双端分流逻辑
    if (isExtension) {
        // 在电脑 Chrome 扩展环境：允许抓取，读取本地缓存
        if (result.mathNewsCache) localCache = result.mathNewsCache;
        document.getElementById('env-hint').innerText = "本地爬虫引擎已就绪，请按需点击更新后推送至云端。";
    } else {
        // 在手机 Web/GitHub Pages 环境：只读模式，隐藏所有扩展专属按钮
        document.querySelectorAll('.extension-only').forEach(el => el.style.display = 'none');
        document.getElementById('env-hint').innerText = "移动端云同步模式：正在获取最新情报库...";
        
        try {
            document.getElementById('loading').style.display = 'block';
            // 添加时间戳防止手机浏览器缓存旧的 json 文件
            // 新代码：直接读取 GitHub 的 Raw 原始接口，实现 0 延迟秒级同步！
            const rawUrl = `https://raw.githubusercontent.com/${githubConfig.repo}/main/${githubConfig.path}?t=${Date.now()}`;
            const cloudRes = await fetch(rawUrl);
            if (cloudRes.ok) {
                localCache = await cloudRes.json();
                document.getElementById('env-hint').innerText = "情报库已同步至最新版。";
            } else {
                throw new Error("云端文件未找到");
            }
        } catch(e) {
            console.warn("加载云端数据失败:", e);
            document.getElementById('env-hint').innerText = "⚠️ 无法连接到云端仓库，请确认您已通过 PC 扩展执行了推送。";
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }
    
    extractAndPopulateTags();
    renderNews();

  } catch (error) {
    console.error("初始化失败:", error);
  }
}

function bindEvents() {
  document.getElementById('filter-date').addEventListener('change', renderNews);
  document.getElementById('filter-tag').addEventListener('change', renderNews);
  document.getElementById('filter-keyword').addEventListener('input', renderNews);
  
  const hideEmptyCb = document.getElementById('filter-hide-empty');
  if (hideEmptyCb) hideEmptyCb.addEventListener('change', renderNews);
  
  // 扩展专用的操作绑定
  const updateAllBtn = document.getElementById('update-all-btn');
  if(updateAllBtn) updateAllBtn.addEventListener('click', updateAllSources);
  
  const syncBtn = document.getElementById('sync-github-btn');
  if(syncBtn) syncBtn.addEventListener('click', syncToGitHub);

  const clearBtn = document.getElementById('clear-all-cache-btn');
  if(clearBtn) clearBtn.addEventListener('click', clearAllCaches);
  
  const manageBtn = document.getElementById('open-manage-btn');
  if(manageBtn) manageBtn.addEventListener('click', () => openManageModal());
  
  // 弹窗关闭事件
  const manageModal = document.getElementById('manage-modal');
  document.getElementById('close-manage-btn').addEventListener('click', () => {
      manageModal.style.display = 'none';
      const mt = document.getElementById('modal-tools');
      if (mt) mt.style.display = 'none';
  });
  manageModal.addEventListener('click', function(e) {
      if (e.target === this) {
          this.style.display = 'none';
          const mt = document.getElementById('modal-tools');
          if (mt) mt.style.display = 'none';
      }
  });

  const previewModal = document.getElementById('preview-modal');
  document.getElementById('close-preview-btn').addEventListener('click', () => previewModal.style.display = 'none');
  previewModal.addEventListener('click', function(e) {
      if (e.target === this) this.style.display = 'none';
  });
  
  // 悬浮按键
  const mainScrollTop = document.getElementById('main-scroll-top');
  if (mainScrollTop) mainScrollTop.addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));
  const mainScrollBottom = document.getElementById('main-scroll-bottom');
  if (mainScrollBottom) mainScrollBottom.addEventListener('click', () => window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'}));

  const modalScrollTop = document.getElementById('modal-scroll-top');
  if (modalScrollTop) modalScrollTop.addEventListener('click', () => document.getElementById('manage-modal-content').scrollTo({top: 0, behavior: 'smooth'}));
  const modalScrollBottom = document.getElementById('modal-scroll-bottom');
  if (modalScrollBottom) modalScrollBottom.addEventListener('click', () => {
      const modalContent = document.getElementById('manage-modal-content');
      modalContent.scrollTo({top: modalContent.scrollHeight, behavior: 'smooth'});
  });

  document.getElementById('add-source-btn').addEventListener('click', () => addManageCard(undefined, document.querySelectorAll('.source-card').length));
  document.getElementById('save-source-btn').addEventListener('click', saveSourcesToLocal);
  document.getElementById('export-source-btn').addEventListener('click', exportSources);
  document.getElementById('import-file-input').addEventListener('change', handleFileImport);
  document.getElementById('upload-json-btn').addEventListener('click', () => document.getElementById('import-json-input').click());
  document.getElementById('import-json-input').addEventListener('change', handleJsonImport);
  document.getElementById('paste-json-btn').addEventListener('click', pasteJsonConfig);
  document.getElementById('reset-source-btn').addEventListener('click', resetSources);
}

// ==========================================
// ☁️ GitHub 同步上传引擎
// ==========================================
async function syncToGitHub() {
    if (!isExtension) return; // 仅 PC 端扩展可用
    
    // 获取最新配置
    const token = githubConfig.token;
    const repo = githubConfig.repo;
    const path = githubConfig.path || 'news_data.json';
    
    if (!token || !repo) {
        alert("⚠️ 推送中断：请先在“管理配置”中填写您的 GitHub Token 和 仓库名称！");
        return openManageModal();
    }

    const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loading').innerText = "☁️ 正在与 GitHub 建立连接并检查文件版本...";

    try {
        // 1. 获取目标文件当前的 SHA (GitHub 规定更新文件必须提供旧版本的 SHA)
        let fileSha = "";
        const getRes = await fetch(apiUrl, {
            headers: { "Authorization": `token ${token}` }
        });
        
        if (getRes.ok) {
            const fileData = await getRes.json();
            fileSha = fileData.sha;
        } else if (getRes.status !== 404) {
            throw new Error(`获取文件信息失败: ${getRes.statusText}`);
        }

        document.getElementById('loading').innerText = "📦 正在打包编译情报库并推送到云端...";

        // 2. 将 localCache 转换为安全的 Base64 编码 (兼容中文字符)
        const jsonString = JSON.stringify(localCache);
        // 使用 btoa 和 encodeURIComponent 来安全处理 Unicode 中文
        const contentBase64 = btoa(unescape(encodeURIComponent(jsonString)));

        // 3. 构建提交请求体
        const requestBody = {
            message: `Auto Sync News Data via Extension - ${new Date().toLocaleString()}`,
            content: contentBase64
        };
        if (fileSha) requestBody.sha = fileSha; // 如果文件已存在，附带 sha 表示更新操作

        // 4. 执行上传 (PUT 请求)
        const putRes = await fetch(apiUrl, {
            method: "PUT",
            headers: {
                "Authorization": `token ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        if (putRes.ok) {
            alert("✅ 数据已成功推送至 GitHub！\n现在您可以刷新您的手机端网页查看最新情报了。");
        } else {
            const errorInfo = await putRes.json();
            throw new Error(errorInfo.message || "上传请求被拒绝");
        }

    } catch (error) {
        console.error("GitHub 同步失败:", error);
        alert(`❌ 同步失败: ${error.message}\n请检查您的 Token 权限或仓库名称是否正确。`);
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('loading').innerText = "📡 系统处理中，请稍候...";
    }
}

function extractAndPopulateTags() {
  const tagsSet = new Set();
  globalSources.forEach(s => {
    if (s.tags) s.tags.forEach(t => tagsSet.add(t));
  });
  
  const select = document.getElementById('filter-tag');
  select.innerHTML = '<option value="all">所有标签</option>';
  tagsSet.forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    select.appendChild(opt);
  });
}

function getHomepageUrl(source) {
  if (source.homepage) return source.homepage; 
  if (source.type === 'html' || source.type === 'json') return source.url; 

  try {
    const urlObj = new URL(source.url);
    let hostname = urlObj.hostname;
    
    const isBlog = hostname.includes('wordpress.com') || 
                   hostname.includes('blogspot.com') || 
                   hostname.includes('github.io') ||
                   hostname.includes('medium.com');
                   
    const parts = hostname.split('.');
    
    if (parts.length >= 3 && parts[0] !== 'www' && !isBlog) {
      parts[0] = 'www';
      hostname = parts.join('.');
    }
    
    return urlObj.protocol + '//' + hostname;
  } catch (e) {
    return source.url; 
  }
}

function formatNewsDate(timestamp) {
  if (isNaN(timestamp)) return '未知时间';
  const dateObj = new Date(timestamp);
  const currentYear = new Date().getFullYear();
  
  if (dateObj.getFullYear() === currentYear) {
     return dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } else {
     return dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}

function renderNews() {
  const dateRange = document.getElementById('filter-date').value;
  const tagFilter = document.getElementById('filter-tag').value;
  const keyword = document.getElementById('filter-keyword').value.toLowerCase();
  
  const hideEmptyCb = document.getElementById('filter-hide-empty');
  const hideEmpty = hideEmptyCb ? hideEmptyCb.checked : false;
  
  const container = document.getElementById('news-container');
  container.innerHTML = '';

  globalSources.forEach(source => {
    if (tagFilter !== 'all' && (!source.tags || !source.tags.includes(tagFilter))) return;

    let items = localCache[source.name] || [];
    items = items.filter(news => {
      if (keyword && !news.title.toLowerCase().includes(keyword)) return false;
      if (!checkDate(news.timestamp, dateRange)) return false;
      return true;
    });

    if (hideEmpty && items.length === 0) return;

    renderSourceGroup(source, items, container);
  });
}

function escapeHtml(text) {
    if (!text) return "";
    return String(text)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function createNewsItemHtml(news) {
  const dateStr = formatNewsDate(news.timestamp);
  const authorText = news.author ? escapeHtml(news.author) : ''; 
  
  return `
    <div class="news-item">
      <a href="${escapeHtml(news.link)}" target="_blank" class="news-title">${escapeHtml(news.title)}</a>
      <div class="news-meta">
        <span>👤 ${authorText}</span>
        <span>📅 ${dateStr}</span>
      </div>
    </div>
  `;
}

function renderSourceGroup(source, items, container) {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'source-group';
  
  const tagsHTML = (source.tags || []).map(t => `<span class="source-tags">${t}</span>`).join('');
  const homepageUrl = getHomepageUrl(source);
  
  const lastUpdateMs = updateTimesCache[source.name];
  const updateTooltip = lastUpdateMs 
      ? `上次更新: ${new Date(lastUpdateMs).toLocaleString('zh-CN')}`
      : `尚未获取数据`;

  const limit = globalDisplayLimit;
  const visibleItems = items.slice(0, limit);
  const hiddenItems = items.slice(limit);
  const hasHidden = hiddenItems.length > 0;

  // 根据环境决定是否展示 "更新" "清空" "编辑" 等控制按钮
  const hoverActionsHTML = isExtension ? `
        <div class="hover-actions">
            ${hasHidden ? `<button class="action-btn top-toggle-btn" title="展开/收起多余新闻">🔽</button>` : ''}
            <button class="action-btn clear-source-btn" data-source="${source.name}" title="清除该源的本地缓存">🗑️</button>
            <button class="action-btn edit-source-btn" data-source="${source.name}" title="修改抓取配置">⚙️</button>
        </div>
        <button class="action-btn update-source-btn" data-source="${source.name}" title="${updateTooltip}">🔄 更新</button>
  ` : `
        <div class="hover-actions">
            ${hasHidden ? `<button class="action-btn top-toggle-btn" title="展开/收起多余新闻">🔽</button>` : ''}
        </div>
  `;

  groupDiv.innerHTML = `
    <div class="source-header">
      <div>
        <a href="${homepageUrl}" target="_blank" class="source-title-link" title="左键: 访问主页\n右键: 访问 Feed 源">${source.name}</a>
        <div style="margin-top:5px;">${tagsHTML}</div>
      </div>
      <div class="action-group">
        ${hoverActionsHTML}
      </div>
    </div>
    <div class="items-container"></div>
  `;
  
  const itemsContainer = groupDiv.querySelector('.items-container');
  
  if (items.length === 0) {
    itemsContainer.innerHTML = '<p style="font-size:12px; color:#999;">暂无数据或无符合条件的记录。</p>';
  } else {
    let itemsHtml = visibleItems.map(createNewsItemHtml).join('');
    
    if (hasHidden) {
      itemsHtml += `<div class="hidden-news-container" style="display:none;">`;
      itemsHtml += hiddenItems.map(createNewsItemHtml).join('');
      itemsHtml += `</div>`;
      itemsHtml += `<button class="toggle-more-btn">展开剩余 ${hiddenItems.length} 条 ▼</button>`;
    }
    
    itemsContainer.innerHTML = itemsHtml;
    
    const topToggleBtn = groupDiv.querySelector('.top-toggle-btn');
    const bottomToggleBtn = groupDiv.querySelector('.toggle-more-btn');
    const hiddenContainer = groupDiv.querySelector('.hidden-news-container');

    const toggleVisibility = () => {
        if (!hiddenContainer) return;
        const isHidden = hiddenContainer.style.display === 'none';
        if (isHidden) {
            hiddenContainer.style.display = 'block';
            if (topToggleBtn) topToggleBtn.innerText = '🔼';
            if (bottomToggleBtn) bottomToggleBtn.innerText = '折叠收起 ▲';
        } else {
            hiddenContainer.style.display = 'none';
            if (topToggleBtn) topToggleBtn.innerText = '🔽';
            if (bottomToggleBtn) bottomToggleBtn.innerText = `展开剩余 ${hiddenItems.length} 条 ▼`;
        }
    };

    if (topToggleBtn) topToggleBtn.addEventListener('click', toggleVisibility);
    if (bottomToggleBtn) bottomToggleBtn.addEventListener('click', toggleVisibility);
  }

  const titleLink = groupDiv.querySelector('.source-title-link');
  titleLink.addEventListener('contextmenu', (e) => {
    e.preventDefault(); 
    window.open(source.url, '_blank');
  });

  if (isExtension) {
      const uBtn = groupDiv.querySelector('.update-source-btn');
      if(uBtn) uBtn.addEventListener('click', () => updateSingleSource(source));
      
      const cBtn = groupDiv.querySelector('.clear-source-btn');
      if(cBtn) cBtn.addEventListener('click', () => clearSingleCache(source.name));
      
      const eBtn = groupDiv.querySelector('.edit-source-btn');
      if(eBtn) eBtn.addEventListener('click', () => openManageModal(source.name));
  }
  
  container.appendChild(groupDiv);
}

function checkDate(timestamp, range) {
  if (range === 'all' || isNaN(timestamp)) return true;
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;

  if (range === 'today') return timestamp >= todayStart;
  if (range === 'yesterday') return timestamp >= todayStart - dayMs && timestamp < todayStart;
  if (range === '3days') return timestamp >= todayStart - 2 * dayMs;
  if (range === '7days') return timestamp >= todayStart - 6 * dayMs;
  if (range === '30days') return timestamp >= todayStart - 29 * dayMs;
  if (range === '60days') return timestamp >= todayStart - 59 * dayMs;
  
  const d = new Date(timestamp);
  if (range === 'thisMonth') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (range === 'lastMonth') {
    let lm = now.getMonth() - 1;
    let y = now.getFullYear();
    if (lm < 0) { lm = 11; y--; }
    return d.getMonth() === lm && d.getFullYear() === y;
  }
  return true;
}

function clearAllCaches() {
  if (!confirm('确定要清空所有新闻源的已抓取缓存吗？\n（不会影响您的新闻源规则配置）')) return;
  localCache = {};
  updateTimesCache = {};
  AppStorage.set({ mathNewsCache: localCache, updateTimesCache: updateTimesCache }).then(() => {
    renderNews(); 
  });
}

function clearSingleCache(sourceName) {
  delete localCache[sourceName];
  delete updateTimesCache[sourceName];
  AppStorage.set({ mathNewsCache: localCache, updateTimesCache: updateTimesCache }).then(() => {
    renderNews(); 
  });
}

function printDebugLog(source, finalUrl, items, dateHintUsed) {
  console.groupCollapsed(`📡 [抓取调试] 新闻源: ${source.name}`);
  console.log(`- 请求地址: ${source.url} [${source.method || 'GET'}]`);
  console.log(`- 实际响应URL: ${finalUrl}`);
  if (source.type === 'html' || source.type === 'json') {
      console.log(`- 解析策略: ${dateHintUsed}`);
  }
  console.log(`- 共提取到 ${items.length} 条有效数据。明细如下：`);
  
  const tableData = items.map(item => ({
    "新闻标题": item.title,
    "绝对链接 (Link)": item.link,
    "提取日期": formatNewsDate(item.timestamp),
    "原始提取文本": item._rawDateText || "无",
    "作者": item.author || "无"
  }));
  
  console.table(tableData);
  console.groupEnd();
}

function generateStringHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        let char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function cleanDateString(text) {
    if (!text) return "";
    let t = text.replace(/[\r\n\t]+/g, ' '); 
    t = t.replace(/\b(20\d{2})\d+\b/g, '$1').trim();
    t = t.replace(/^[.,:;!?()\[\]{}*~_=\|\\\/"]+|[.,:;!?()\[\]{}*~_=\|\\\/"]+$/g, '').trim();
    return t;
}

function getMonthNumber(word) {
    const w = word.toLowerCase();
    if (/^(jan|gen|ene)/.test(w)) return 1;
    if (/^(feb|fév|fev)/.test(w)) return 2;
    if (/^(mar|mär)/.test(w)) return 3;
    if (/^(apr|abr|avr)/.test(w)) return 4;
    if (/^(may|mag|mai)/.test(w)) return 5;
    if (/^(jun|giu|juin)/.test(w)) return 6;
    if (/^(jul|lug|juil)/.test(w)) return 7;
    if (/^(aug|ago|aoû|aou)/.test(w)) return 8;
    if (/^(sep|set)/.test(w)) return 9;
    if (/^(oct|ott|okt)/.test(w)) return 10;
    if (/^(nov)/.test(w)) return 11;
    if (/^(dec|dic|dez|déc)/.test(w)) return 12;
    return null;
}

const multiDateRegex1 = /([a-zA-ZÀ-ÿ]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:(?:[\s,]+)(19\d{2}|20\d{2}))?(?=[^\d]|$)/i;
const multiDateRegex2 = /(?:^|[^\d])(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-ZÀ-ÿ]{3,10})\.?(?:(?:[\s,]+)(19\d{2}|20\d{2}))?(?=[^\d]|$)/i;
const numDateRegex = /(?:^|[^\d])(\d{1,4})[\/\-\.年\s]+(\d{1,4})[\/\-\.月\s]+(\d{1,4})(?:日|[^\d]|$)/;

function analyzeDateFormats(rawDates, tags) {
    let hint = 'unknown'; 
    const tagStr = (tags || []).join(',').toLowerCase();
    
    if (tagStr.includes('美国') || tagStr.includes('us') || tagStr.includes('usa')) hint = 'MM/DD/YYYY';
    else if (tagStr.match(/欧洲|英国|uk|法国|德国/)) hint = 'DD/MM/YYYY';
    else if (tagStr.match(/日本|中国|亚洲|jp|cn|asia/)) hint = 'YYYY/MM/DD'; 

    let validAmbiguousDates = []; 
    for (let text of rawDates) {
        let cleanText = cleanDateString(text);
        if(!cleanText) continue;
        
        let m1 = cleanText.match(multiDateRegex1);
        if (m1 && getMonthNumber(m1[1])) continue;
        let m2 = cleanText.match(multiDateRegex2);
        if (m2 && getMonthNumber(m2[2])) continue;
        
        const match = cleanText.match(numDateRegex);
        if (match) {
            let p1 = parseInt(match[1], 10);
            let p2 = parseInt(match[2], 10);
            let p3 = parseInt(match[3], 10);
            
            if (match[1].length === 4) continue; 
            else if (match[3].length === 4) {
                if (p1 > 12 && p2 <= 12) return 'DD/MM/YYYY'; 
                if (p2 > 12 && p1 <= 12) return 'MM/DD/YYYY'; 
                validAmbiguousDates.push({p1, p2, year: p3});
            } else if (match[2].length === 4) {
                if (p1 > 12 && p3 <= 12) return 'DD/MM/YYYY'; 
                if (p3 > 12 && p1 <= 12) return 'MM/DD/YYYY'; 
                validAmbiguousDates.push({p1: p1, p2: p3, year: p2});
            } else {
                if (p1 > 31) return 'YYYY/MM/DD'; 
                if (p3 > 31) { 
                    if (p1 > 12) return 'DD/MM/YYYY';
                    if (p2 > 12) return 'MM/DD/YYYY';
                }
                validAmbiguousDates.push({p1, p2, p3}); 
            }
        }
    }

    if (validAmbiguousDates.length >= 2) {
        let usOrderScore = 0;
        let euOrderScore = 0;
        let asOrderScore = 0;
        const makeDate = (y, m, d) => new Date(`${y < 100 ? y+2000 : y}/${m}/${d}`).getTime();

        for(let i = 0; i < validAmbiguousDates.length - 1; i++) {
            let curr = validAmbiguousDates[i];
            let next = validAmbiguousDates[i+1];
            
            let currEu = makeDate(curr.p3||curr.year, curr.p2, curr.p1);
            let nextEu = makeDate(next.p3||next.year, next.p2, next.p1);
            if(!isNaN(currEu) && !isNaN(nextEu) && currEu >= nextEu) euOrderScore++;

            let currUs = makeDate(curr.p3||curr.year, curr.p1, curr.p2);
            let nextUs = makeDate(next.p3||next.year, next.p1, next.p2);
            if(!isNaN(currUs) && !isNaN(nextUs) && currUs >= nextUs) usOrderScore++;
            
            let currAs = makeDate(curr.p1, curr.p2, curr.p3||curr.year);
            let nextAs = makeDate(next.p1, next.p2, next.p3||next.year);
            if(!isNaN(currAs) && !isNaN(nextAs) && currAs >= nextAs) asOrderScore++;
        }
        if (euOrderScore > usOrderScore && euOrderScore > asOrderScore) return 'DD/MM/YYYY';
        if (usOrderScore > euOrderScore && usOrderScore > asOrderScore) return 'MM/DD/YYYY';
        if (asOrderScore > euOrderScore && asOrderScore > usOrderScore) return 'YYYY/MM/DD';
    }
    return hint !== 'unknown' ? hint : 'MM/DD/YYYY'; 
}

function parseCustomDateWithHint(text, formatHint) {
    if (!text) return null;
    let cleanText = cleanDateString(text);
    
    let m1 = cleanText.match(multiDateRegex1);
    if (m1) {
        let mNum = getMonthNumber(m1[1]);
        if (mNum) {
            let day = parseInt(m1[2], 10);
            let year = m1[3] ? parseInt(m1[3], 10) : new Date().getFullYear();
            const d = new Date(`${year}/${mNum}/${day}`);
            if (!isNaN(d.getTime())) return d.getTime();
        }
    }
    
    let m2 = cleanText.match(multiDateRegex2);
    if (m2) {
        let mNum = getMonthNumber(m2[2]);
        if (mNum) {
            let day = parseInt(m2[1], 10);
            let year = m2[3] ? parseInt(m2[3], 10) : new Date().getFullYear();
            const d = new Date(`${year}/${mNum}/${day}`);
            if (!isNaN(d.getTime())) return d.getTime();
        }
    }
    
    const numMatch = cleanText.match(numDateRegex);
    if (numMatch) {
        let p1 = parseInt(numMatch[1], 10);
        let p2 = parseInt(numMatch[2], 10);
        let p3 = parseInt(numMatch[3], 10);
        let year, month, day;

        if (numMatch[1].length === 4) {
            year = p1; month = p2; day = p3;
        } else if (numMatch[3].length === 4) {
            year = p3;
            if (formatHint === 'DD/MM/YYYY') { day = p1; month = p2; }
            else { month = p1; day = p2; }
        } else if (numMatch[2].length === 4) {
            year = p2;
            if (formatHint === 'DD/MM/YYYY') { day = p1; month = p3; }
            else { month = p1; day = p3; }
        } else {
            if (formatHint === 'DD/MM/YYYY') { day = p1; month = p2; year = p3; } 
            else if (formatHint === 'YYYY/MM/DD') { year = p1; month = p2; day = p3; } 
            else { month = p1; day = p2; year = p3; }
            year = year < 50 ? 2000 + year : 1900 + year;
        }
        
        const d = new Date(`${year}/${month}/${day}`);
        if (!isNaN(d.getTime())) return d.getTime();
    }

    if (cleanText.length < 80) {
        let parsed = new Date(cleanText);
        if (!isNaN(parsed.getTime())) {
            if (parsed.getFullYear() === 2001 && !cleanText.includes('2001')) {
                parsed.setFullYear(new Date().getFullYear());
            }
            if (parsed.getFullYear() > 1900 && parsed.getFullYear() < 2100) {
                return parsed.getTime();
            }
        }
        
        if (!/(?:19|20)\d{2}/.test(cleanText)) {
            let fallbackParsed = new Date(`${cleanText} ${new Date().getFullYear()}`);
            if (!isNaN(fallbackParsed.getTime()) && fallbackParsed.getFullYear() > 1900 && fallbackParsed.getFullYear() < 2100) {
                return fallbackParsed.getTime();
            }
        }
    }
    return null;
}

const lenientDateValidator = (n) => {
    let cleanText = cleanDateString(n.textContent || n.value || "");
    if (numDateRegex.test(cleanText)) return true;
    let m1 = cleanText.match(multiDateRegex1);
    if (m1 && getMonthNumber(m1[1])) return true;
    let m2 = cleanText.match(multiDateRegex2);
    if (m2 && getMonthNumber(m2[2])) return true;
    if (cleanText.length < 80 && !isNaN(new Date(cleanText).getTime())) return true;
    return false;
};

function extractDateFromUrl(url) {
    if (!url) return null;
    const match = url.match(/(19|20\d{2})[\/\-](0?[1-9]|1[0-2])(?:[\/\-](0?[1-9]|[12]\d|3[01]))?\b/);
    if (match) {
        const year = match[1];
        const month = match[2];
        const day = match[3] || '1';
        const d = new Date(`${year}/${month}/${day}`);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    return null;
}

function findRelativeNode(baseNode, selectorQuery, validator = null) {
  if (!selectorQuery) return null;
  
  let attrName = null;
  let mainQuery = selectorQuery;
  const attrIndex = selectorQuery.indexOf('->');
  if (attrIndex > -1) {
      attrName = selectorQuery.substring(attrIndex + 2).trim();
      mainQuery = selectorQuery.substring(0, attrIndex).trim();
  }

  const wrapResult = (node) => {
      if (!node) return null;
      if (!attrName) return node;
      
      const attrVal = node.getAttribute(attrName) || "";
      return {
          isWrappedAttr: true,
          tagName: node.tagName,
          getAttribute: (a) => node.getAttribute(a),
          querySelector: (s) => node.querySelector(s),
          matches: (s) => node.matches && node.matches(s),
          innerText: attrVal,
          textContent: attrVal
      };
  };

  if (mainQuery.startsWith('after:')) {
      const sel = mainQuery.substring(6).trim();
      const target = sel ? baseNode.querySelector(sel) : baseNode;
      if (target) {
          let sibling = target.nextSibling;
          while (sibling) {
              if (sibling.textContent && sibling.textContent.trim()) {
                  if (!validator || validator(sibling)) return wrapResult(sibling);
              }
              sibling = sibling.nextSibling;
          }
      }
      return null;
  }

  if (mainQuery.startsWith('before:')) {
      const sel = mainQuery.substring(7).trim();
      const target = sel ? baseNode.querySelector(sel) : baseNode;
      if (target) {
          let sibling = target.previousSibling;
          while (sibling) {
              if (sibling.textContent && sibling.textContent.trim()) {
                  if (!validator || validator(sibling)) return wrapResult(sibling);
              }
              sibling = sibling.previousSibling;
          }
      }
      return null;
  }

  const isPrev = mainQuery.startsWith('prev:');
  const isNext = mainQuery.startsWith('next:');
  
  if (isPrev || isNext) {
    const sel = mainQuery.substring(5).trim();
    const dir = isPrev ? 'previousSibling' : 'nextSibling'; 
    
    let current = baseNode;
    while (current && current.nodeName !== 'BODY' && current.nodeName !== 'HTML') {
      let sibling = current[dir];
      
      while (sibling) {
        if (sel) {
          if (sibling.nodeType === 1) { 
            if (sibling.matches(sel)) return wrapResult(sibling);
            const inside = sibling.querySelector(sel);
            if (inside) return wrapResult(inside);
          }
        } else {
          let text = sibling.textContent || "";
          if (text.trim()) {
              if (validator) {
                  if (validator(sibling)) return wrapResult(sibling);
              } else {
                  return wrapResult(sibling);
              }
          }
        }
        sibling = sibling[dir]; 
      }
      current = current.parentElement; 
    }
    return null;
  }

  const directNode = baseNode.querySelector(mainQuery) || (baseNode.matches && baseNode.matches(mainQuery) ? baseNode : null);
  return wrapResult(directNode);
}

function isValidLink(link) {
    if (!link) return false;
    const l = link.trim().toLowerCase();
    if (l === '' || l.startsWith('javascript:') || l.startsWith('mailto:')) return false;
    if (!l.startsWith('http')) return false; 
    return true;
}

function getObjectPathValue(obj, path) {
    if (!path || !obj) return null;
    if (path === '$' || path === 'root') return obj;
    let normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
    return normalizedPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : null, obj);
}

function decodeHTMLEntities(text) {
    if (!text) return "";
    const textArea = document.createElement('textarea');
    textArea.innerHTML = text;
    return textArea.value;
}

function getFetchOptions(source) {
    let opts = { method: source.method || 'GET' };
    if (opts.method === 'POST' && source.payload) {
        opts.body = source.payload;
        opts.headers = {};
        if (/^\s*[\{\[]/.test(source.payload)) {
            opts.headers['Content-Type'] = 'application/json';
        } else {
            opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
    }
    return opts;
}

async function fetchJSON(source) {
    try {
        const res = await fetch(source.url, getFetchOptions(source));
        const data = await res.json();
        const rules = source.rules;
        const finalBaseUrl = res.url || source.url;

        let listPath = rules.item || '';
        let filterKey = '';
        let filterValue = '';

        if (listPath.includes('|')) {
            const parts = listPath.split('|');
            listPath = parts[0].trim();
            const filterPart = parts[1].trim();
            const eqIndex = filterPart.indexOf('=');
            if (eqIndex > -1) {
                filterKey = filterPart.substring(0, eqIndex).trim();
                filterValue = filterPart.substring(eqIndex + 1).trim();
            }
        }

        let list = [];
        if (!listPath || listPath === '$' || listPath === 'root') {
            list = Array.isArray(data) ? data : [data];
        } else {
            let extracted = getObjectPathValue(data, listPath);
            list = Array.isArray(extracted) ? extracted : (extracted ? [extracted] : []);
        }

        if (filterKey && filterValue) {
            list = list.filter(node => {
                const val = getObjectPathValue(node, filterKey);
                if (Array.isArray(val)) {
                    return val.some(v => String(v).includes(filterValue));
                } else if (val !== null && val !== undefined) {
                    return String(val).includes(filterValue);
                }
                return false;
            });
        }

        let tempItems = [];
        let linkRule = source.rules.link || "";
        let linkPrefix = "";
        const prefixMatch = linkRule.match(/^["']?(https?:\/\/[^"'\s]+)["']?\s*\+\s*(.+)$/i);
        if (prefixMatch) {
            linkPrefix = prefixMatch[1];
            linkRule = prefixMatch[2];
        }

        list.forEach(node => {
            let rawTitle = getObjectPathValue(node, rules.title);
            let rawLink = getObjectPathValue(node, linkRule);
            let rawAuthor = getObjectPathValue(node, rules.author);

            let titleStr = "无标题";
            if (rawTitle !== null && rawTitle !== undefined) {
                titleStr = decodeHTMLEntities(String(rawTitle)).trim() || "无标题";
            }

            let linkStr = "";
            let unescapedLink = "";
            if (rawLink !== null && rawLink !== undefined) {
                unescapedLink = String(rawLink).replace(/\\/g, '').trim();
                if (unescapedLink && !unescapedLink.toLowerCase().startsWith('javascript:')) {
                    if (linkPrefix) {
                        linkStr = (linkPrefix + unescapedLink).replace(/([^:])\/\//g, '$1/');
                    } else {
                        try { linkStr = new URL(unescapedLink, finalBaseUrl).href; } catch(e) {}
                    }
                }
            }
            
            if (!isValidLink(linkStr)) {
                if (titleStr && titleStr !== "无标题" && titleStr.length > 0) {
                    const hash = generateStringHash(titleStr);
                    linkStr = finalBaseUrl.split('#')[0] + "#mathnews-" + hash;
                } else {
                    return; 
                }
            }

            let rawDateStr = "";
            if (rules.date) {
                if (rules.date.includes('{') && rules.date.includes('}')) {
                    rawDateStr = rules.date.replace(/\{([^}]+)\}/g, (match, path) => {
                        let val = getObjectPathValue(node, path.trim());
                        return val !== null && val !== undefined ? String(val).trim() : "";
                    });
                } else {
                    let rawDate = getObjectPathValue(node, rules.date);
                    rawDateStr = rawDate !== null && rawDate !== undefined ? String(rawDate) : "";
                }
            }

            tempItems.push({
                title: titleStr,
                link: linkStr,
                rawDateText: rawDateStr,
                author: (rawAuthor !== null && rawAuthor !== undefined) ? String(rawAuthor).trim() : "",
                _rawHref: unescapedLink
            });
        });

        const allRawDates = tempItems.map(item => item.rawDateText);
        const formatHint = analyzeDateFormats(allRawDates, source.tags);
        
        let items = tempItems.map(item => {
           let finalTimestamp = Date.now();
           let dateHintUsed = formatHint;

           if (item.rawDateText) {
               const isoD = new Date(item.rawDateText);
               if (!isNaN(isoD.getTime())) {
                   finalTimestamp = isoD.getTime();
               } else {
                   const parsedTime = parseCustomDateWithHint(item.rawDateText, formatHint);
                   if (parsedTime) finalTimestamp = parsedTime;
               }
           }
           
           if (finalTimestamp === Date.now() && item.link && !item.link.includes('#mathnews-')) {
               const urlTime = extractDateFromUrl(item.link);
               if (urlTime) {
                   finalTimestamp = urlTime;
                   dateHintUsed = "URL Extract Fallback";
               }
           }

           return {
              title: item.title,
              link: item.link,
              timestamp: finalTimestamp,
              author: item.author,
              _rawHref: item._rawHref,
              _rawDateText: item.rawDateText || (dateHintUsed === "URL Extract Fallback" ? "[来自URL提取]" : "")
           };
        });

        printDebugLog(source, finalBaseUrl, items, `JSON 属性提取 (后备: ${formatHint})`);
        return items;
    } catch (e) {
        console.error(`JSON抓取失败 ${source.name}:`, e);
        return [];
    }
}

async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, getFetchOptions(source));
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const finalBaseUrl = res.url || source.url;
    let items = [];
    const entries = doc.querySelectorAll("item, entry");
    
    entries.forEach(item => {
      let title = item.querySelector("title")?.textContent || "无标题";
      let rawLink = item.querySelector("link:not([rel])")?.textContent || item.querySelector("link[rel='alternate']")?.getAttribute("href") || item.querySelector("link")?.getAttribute("href") || "";
      
      let finalLink = rawLink.trim();
      
      if (!isValidLink(finalLink)) {
          if (title && title !== "无标题" && title.length > 0) {
              const hash = generateStringHash(title);
              finalLink = finalBaseUrl.split('#')[0] + "#mathnews-" + hash;
          } else {
              return;
          }
      }

      let pubDate = item.querySelector("pubDate")?.textContent || item.querySelector("published")?.textContent || item.querySelector("updated")?.textContent;
      let timestamp = Date.now();
      
      if (pubDate) {
         timestamp = new Date(pubDate).getTime();
      } else if (!finalLink.includes('#mathnews-')) {
         let urlDate = extractDateFromUrl(finalLink);
         if (urlDate) timestamp = urlDate;
      }

      items.push({
        title: title,
        link: finalLink,
        timestamp: timestamp,
        author: item.querySelector("author, creator")?.textContent || "",
        _rawHref: rawLink
      });
    });
    
    printDebugLog(source, res.url, items, "标准RSS无需推断");
    return items;
  } catch (e) { console.error(`RSS抓取失败 ${source.name}:`, e); return []; }
}

async function fetchHTML(source) {
  try {
    const res = await fetch(source.url, getFetchOptions(source));
    const htmlText = await res.text();
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    const rules = source.rules;
    const finalBaseUrl = res.url || source.url;
    
    let linkRule = source.rules.link || "";
    let linkPrefix = "";
    const prefixMatch = linkRule.match(/^["']?(https?:\/\/[^"'\s]+)["']?\s*\+\s*(.+)$/i);
    if (prefixMatch) {
        linkPrefix = prefixMatch[1];
        linkRule = prefixMatch[2];
    }
    
    const nodes = doc.querySelectorAll(rules.item);
    let tempItems = [];
    
    nodes.forEach(node => {
      const titleEl = rules.title ? findRelativeNode(node, rules.title) : node;
      const linkEl = linkRule ? findRelativeNode(node, linkRule) : node;
      const authorEl = rules.author ? findRelativeNode(node, rules.author) : null;

      let rawHref = "";
      if (linkEl) {
         if (linkEl.isWrappedAttr) {
             rawHref = linkEl.textContent || "";
             const quoteMatch = rawHref.match(/['"]([^'"]+)['"]/);
             if (quoteMatch) {
                 rawHref = quoteMatch[1];
             }
         } else if (linkEl.tagName && linkEl.tagName.toUpperCase() === 'A') {
             rawHref = linkEl.getAttribute('href');
         } else if (linkEl.querySelector) {
             const aTag = linkEl.querySelector('a');
             if (aTag) rawHref = aTag.getAttribute('href');
         }
      }

      let rawDateText = "";
      if (rules.date) {
          if (rules.date.includes('{') && rules.date.includes('}')) {
              rawDateText = rules.date.replace(/\{([^}]+)\}/g, (match, sel) => {
                  const partNode = findRelativeNode(node, sel.trim());
                  return partNode ? (partNode.innerText || partNode.textContent || "").trim() : "";
              });
          } else {
              const dateEl = findRelativeNode(node, rules.date, lenientDateValidator);
              rawDateText = dateEl ? (dateEl.innerText || dateEl.textContent).trim() : "";
          }
      }

      tempItems.push({
          title: titleEl ? (titleEl.innerText || titleEl.textContent).trim() : "无标题",
          rawHref: (rawHref || "").trim(),
          rawDateText: rawDateText,
          author: authorEl ? (authorEl.innerText || authorEl.textContent).trim() : ""
      });
    });

    const allRawDates = tempItems.map(item => item.rawDateText);
    const formatHint = analyzeDateFormats(allRawDates, source.tags);
    
    let items = [];
    tempItems.forEach(item => {
       let linkStr = "";
       if(item.rawHref && !item.rawHref.toLowerCase().startsWith('javascript:')) {
           if (linkPrefix) {
               linkStr = (linkPrefix + item.rawHref).replace(/([^:])\/\//g, '$1/');
           } else {
               try { linkStr = new URL(item.rawHref, finalBaseUrl).href; } catch(e) {}
           }
       }
       
       if (!isValidLink(linkStr)) {
           if (item.title && item.title !== "无标题" && item.title.length > 0) {
               const hash = generateStringHash(item.title);
               linkStr = finalBaseUrl.split('#')[0] + "#mathnews-" + hash;
           } else {
               return; 
           }
       }

       let finalTimestamp = Date.now();
       let dateHintUsed = formatHint;

       if (item.rawDateText) {
           const parsedTime = parseCustomDateWithHint(item.rawDateText, formatHint);
           if (parsedTime) finalTimestamp = parsedTime;
       }
       
       if (finalTimestamp === Date.now() && linkStr && !linkStr.includes('#mathnews-')) {
           const urlTime = extractDateFromUrl(linkStr);
           if (urlTime) {
               finalTimestamp = urlTime;
               dateHintUsed = "URL Extract Fallback";
           }
       }

       items.push({
          title: item.title,
          link: linkStr,
          timestamp: finalTimestamp,
          author: item.author,
          _rawHref: item.rawHref,
          _rawDateText: item.rawDateText || (dateHintUsed === "URL Extract Fallback" ? "[来自URL提取]" : "")
       });
    });
    
    printDebugLog(source, finalBaseUrl, items, formatHint);
    return items;
  } catch (e) { console.error(`HTML抓取失败 ${source.name}:`, e); return []; }
}

async function updateSingleSource(source) {
  if (!isExtension) return; // 云端模式禁止抓取操作
  document.getElementById('loading').style.display = 'block';
  let fetchedItems = [];
  
  if (source.type === 'rss') {
    fetchedItems = await fetchRSS(source);
  } else if (source.type === 'html') {
    fetchedItems = await fetchHTML(source);
  } else if (source.type === 'json') {
    fetchedItems = await fetchJSON(source);
  }

  let existingItems = localCache[source.name] || [];
  
  const getUniqueKey = (item) => item.link || (item.title + "_" + item.timestamp);
  const keySet = new Set(existingItems.map(getUniqueKey));
  
  fetchedItems.forEach(item => {
    const key = getUniqueKey(item);
    if (!keySet.has(key)) {
      existingItems.push(item);
      keySet.add(key);
    }
  });

  existingItems.sort((a, b) => b.timestamp - a.timestamp);
  localCache[source.name] = existingItems.slice(0, 50);

  updateTimesCache[source.name] = Date.now();

  AppStorage.set({ mathNewsCache: localCache, updateTimesCache: updateTimesCache }).then(() => {
    document.getElementById('loading').style.display = 'none';
    renderNews(); 
  });
}

async function updateAllSources() {
  if (!isExtension) return; // 云端模式禁止抓取操作
  const tagFilter = document.getElementById('filter-tag').value;
  const sourcesToUpdate = globalSources.filter(source => {
    if (tagFilter !== 'all' && (!source.tags || !source.tags.includes(tagFilter))) return false;
    return true;
  });

  if (sourcesToUpdate.length === 0) {
    alert("当前筛选分类下没有新闻源可供更新。");
    return;
  }

  document.getElementById('loading').style.display = 'block';
  for (const source of sourcesToUpdate) {
    await updateSingleSource(source);
  }
  document.getElementById('loading').style.display = 'none';
}

async function autoInferHTMLRules(source) {
    try {
        const res = await fetch(source.url, getFetchOptions(source));
        const htmlText = await res.text();
        const doc = new DOMParser().parseFromString(htmlText, "text/html");
        
        const aTags = doc.querySelectorAll('a');
        const candidates = {};
        
        aTags.forEach(a => {
            const href = a.getAttribute('href');
            if (!href || href.startsWith('javascript:')) return;
            
            if (a.closest('header, footer, nav, aside, menu, [class*="nav" i], [class*="menu" i], [class*="header" i], [class*="footer" i], [id*="nav" i], [id*="menu" i], [id*="header" i], [id*="footer" i]')) {
                return;
            }
            
            let current = a.parentElement;
            let depth = 0;
            while(current && current.tagName !== 'BODY' && depth < 3) {
                const tag = current.tagName.toLowerCase();
                if (['html', 'body', 'main', 'tbody', 'table'].includes(tag)) break;
                
                let key = tag;
                let classNames = "";
                if (current.className && typeof current.className === 'string') {
                    const classes = current.className.trim().split(/\s+/).filter(c => c && !/^(col-|row|mt-|mb-|pt-|pb-|flex)/.test(c)).join('.');
                    if (classes) {
                        key += '.' + classes;
                        classNames = classes.toLowerCase();
                    }
                }
                
                if (!['div.container', 'div.wrapper', 'div.content', 'div.row'].includes(key)) {
                    if (!candidates[key]) {
                        candidates[key] = { count: 0, score: 0, tag: tag, classes: classNames };
                    }
                    candidates[key].count += 1;
                }
                
                current = current.parentElement;
                depth++;
            }
        });
        
        let bestSelector = '';
        let maxScore = -1;
        
        for (let [sel, data] of Object.entries(candidates)) {
            if (data.count >= 3 && data.count <= 100) {
                let currentScore = data.count; 
                if (/(news|entry|item|article|post|topic|list|info|data)/i.test(data.classes)) {
                    currentScore += 100;
                }
                if (['article', 'li', 'tr', 'dt', 'dd', 'p'].includes(data.tag)) {
                    currentScore += 30;
                }
                if (currentScore > maxScore) {
                    maxScore = currentScore;
                    bestSelector = sel;
                }
            }
        }
        
        let bestDateRule = 'time, .date';
        if (bestSelector) {
            const sampleItem = doc.querySelector(bestSelector);
            if (sampleItem) {
                if (sampleItem.querySelector('time')) bestDateRule = 'time';
                else if (sampleItem.querySelector('.date')) bestDateRule = '.date';
            }
        }
        
        return {
            item: bestSelector || 'li',
            title: 'a',
            link: 'a',
            date: bestDateRule,
            author: ''
        };
    } catch(e) {
        console.warn("HTML 智能推断请求失败", e);
        return null;
    }
}

async function autoInferJSONRules(source) {
    try {
        const res = await fetch(source.url, getFetchOptions(source));
        const data = await res.json();
        let arr = Array.isArray(data) ? data : null;
        let itemPath = '';

        if (!arr) {
            for (let key in data) {
                if (Array.isArray(data[key]) && data[key].length > 0) {
                    arr = data[key];
                    itemPath = key;
                    break;
                }
            }
        }

        if (arr && arr.length > 0) {
            const first = arr[0];
            let rules = { item: itemPath, title: '', link: '', date: '', author: '' };

            if (first.title && first.title.rendered) rules.title = 'title.rendered';
            else if (first.title) rules.title = 'title';
            else if (first.name) rules.title = 'name';

            if (first.link) rules.link = 'link';
            else if (first.url) rules.link = 'url';

            if (first.date_gmt) rules.date = 'date_gmt';
            else if (first.date) rules.date = 'date';
            else if (first.published_at) rules.date = 'published_at';
            else if (first.created_at) rules.date = 'created_at';

            if (first.author_name) rules.author = 'author_name';

            return rules;
        }
        return null;
    } catch(e) {
        console.warn("JSON 智能推断请求失败", e);
        return null;
    }
}

function openManageModal(targetName = null) {
  const container = document.getElementById('manage-list');
  container.innerHTML = '';
  globalSources.forEach((s, i) => addManageCard(s, i));
  document.getElementById('manage-modal').style.display = 'flex';
  document.getElementById('modal-tools').style.display = 'flex';
  
  if (targetName) {
      setTimeout(() => {
          const cards = document.querySelectorAll('.source-card');
          for (let card of cards) {
              if (card.querySelector('.m-name').value === targetName) {
                  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  card.classList.add('highlight-card');
                  setTimeout(() => card.classList.remove('highlight-card'), 2500);
                  break;
              }
          }
      }, 100);
  }
}

function getSingleSourceFromCard(card) {
    const type = card.querySelector('.m-type').value;
    const homepageVal = card.querySelector('.m-homepage').value.trim();
    const methodVal = card.querySelector('.m-method').value;
    const payloadVal = card.querySelector('.m-payload').value.trim();

    const s = {
      name: card.querySelector('.m-name').value,
      url: card.querySelector('.m-url').value,
      type: type,
      tags: card.querySelector('.m-tags').value.split(',').map(t=>t.trim()).filter(t=>t)
    };
    
    if(homepageVal) s.homepage = homepageVal;
    
    if (['html', 'json'].includes(type)) {
        if (methodVal === 'POST') {
            s.method = 'POST';
            s.payload = payloadVal;
        } else {
            s.method = 'GET';
        }
    }

    if (type === 'html' || type === 'json') {
      s.rules = {
        item: card.querySelector('.r-item').value,
        title: card.querySelector('.r-title').value,
        link: card.querySelector('.r-link').value,
        date: card.querySelector('.r-date').value,
        author: card.querySelector('.r-author').value
      };
    }
    return s;
}

function updateCardFromObject(card, source) {
    card.querySelector('.m-name').value = source.name || '';
    card.querySelector('.m-url').value = source.url || '';
    card.querySelector('.m-homepage').value = source.homepage || '';
    card.querySelector('.m-tags').value = (source.tags||[]).join(', ');
    card.querySelector('.m-type').value = source.type || 'rss';
    
    const isRuleType = source.type === 'html' || source.type === 'json';
    
    const mMethod = card.querySelector('.m-method');
    const mPayload = card.querySelector('.m-payload');
    const payloadRow = card.querySelector('.payload-row');
    
    if (isRuleType && source.method === 'POST') {
        mMethod.value = 'POST';
        mPayload.value = source.payload || '';
        payloadRow.style.display = 'flex';
    } else {
        mMethod.value = 'GET';
        mPayload.value = '';
        payloadRow.style.display = 'none';
    }

    const panel = card.querySelector('.rules-panel');
    panel.style.display = isRuleType ? 'block' : 'none';
    
    if (isRuleType) {
        const pDesc = panel.querySelector('.rule-desc');
        if (source.type === 'html') {
             pDesc.innerHTML = '* <b>HTML格式</b>：CSS 选择器。支持 <code>-> [attr]</code> 提属性。日期支持宏拼接：<code>{.y}-{.m}</code>。拼接URL：<code>"https://..." + a</code>';
        } else {
             pDesc.innerHTML = '* <b>JSON格式</b>：属性路径。日期支持拼接宏：<code>{y}-{m}</code>。支持过滤如 <code>root | tags=Math</code>。';
        }
    }
    
    if (source.rules) {
        card.querySelector('.r-item').value = source.rules?.item || '';
        card.querySelector('.r-title').value = source.rules?.title || '';
        card.querySelector('.r-link').value = source.rules?.link || '';
        card.querySelector('.r-date').value = source.rules?.date || '';
        card.querySelector('.r-author').value = source.rules?.author || '';
    }
}

function addManageCard(source = {name:'', url:'', homepage:'', type:'rss', tags:[], rules:{}}, index) {
  const card = document.createElement('div');
  card.className = 'source-card';
  const displayIndex = index !== undefined ? index + 1 : '新';
  
  card.innerHTML = `
    <div style="display:flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #ccc; padding-bottom: 10px; margin-bottom: 10px;">
        <div>
            <span class="source-index">#${displayIndex}</span>
            <button class="clip-btn btn-export-clip">📋 复制此配置(JSON)</button>
            <button class="clip-btn btn-import-clip" style="margin-left: 5px;">📥 粘贴覆盖当前</button>
        </div>
        <div>
            <button class="preview-btn" title="预览抓取结果。如果未设置规则，将自动启动 AI 智能推断！">👁️ 预览 / 智能推断</button>
            <button class="btn" style="background:#e74c3c; margin: 0 0 0 10px; padding: 4px 8px; font-size: 12px;" onclick="this.parentElement.parentElement.remove()">删除此源</button>
        </div>
    </div>
    <div class="row">
      <input type="text" class="m-name" placeholder="名称" value="${source.name}">
      <select class="m-method" style="flex: 0 0 80px;" title="请求方法">
        <option value="GET" ${source.method==='POST'?'':'selected'}>GET</option>
        <option value="POST" ${source.method==='POST'?'selected':''}>POST</option>
      </select>
      <input type="text" class="m-url" placeholder="URL(Feed/HTML/JSON API)" value="${source.url}">
    </div>
    <div class="row payload-row" style="display: ${source.method==='POST'?'flex':'none'};">
      <textarea class="m-payload" placeholder="填入 POST 请求体 (如 JSON 字符串: {&quot;key&quot;:&quot;val&quot;} 或 a=1&b=2)" style="flex:1; padding:6px; border:1px solid #ccc; border-radius:4px; height: 30px; resize: vertical; font-family: monospace; font-size: 11px;">${source.payload||''}</textarea>
    </div>
    <div class="row">
      <input type="text" class="m-tags" placeholder="标签(逗号分隔)" value="${(source.tags||[]).join(',')}">
      <input type="text" class="m-homepage" placeholder="主页(不填则自动推导)" value="${source.homepage||''}">
      <select class="m-type">
        <option value="rss" ${source.type==='rss'?'selected':''}>标准 RSS</option>
        <option value="html" ${source.type==='html'?'selected':''}>HTML 自定义</option>
        <option value="json" ${source.type==='json'?'selected':''}>JSON 接口</option>
      </select>
    </div>
    <div class="rules-panel" style="display: ${['html','json'].includes(source.type)?'block':'none'};">
      <strong style="font-size:12px;">抓取规则配置：</strong>
      <p class="rule-desc" style="font-size:11px; color:#666; margin:4px 0;">
        ${source.type === 'json' ? '* <b>JSON格式</b>：属性路径。日期支持拼接宏：<code>{year}-{month}</code>。支持过滤如 <code>root | tags=Math</code>。' : '* <b>HTML格式</b>：CSS 选择器。支持 <code>-> [attr]</code> 提属性。日期支持宏拼接：<code>{.y}-{.m}</code>。拼接URL：<code>"https://..." + a</code>'}
      </p>
      <div class="row">
        <input type="text" class="r-item" placeholder="列表项容器" value="${source.rules?.item||''}">
        <input type="text" class="r-title" placeholder="标题节点" value="${source.rules?.title||''}">
        <input type="text" class="r-link" placeholder="链接节点" value="${source.rules?.link||''}">
      </div>
      <div class="row">
        <input type="text" class="r-date" placeholder="日期节点" value="${source.rules?.date||''}">
        <input type="text" class="r-author" placeholder="作者节点" value="${source.rules?.author||''}">
      </div>
    </div>
  `;
  
  card.querySelector('.m-type').addEventListener('change', (e) => {
    const isRuleType = ['html', 'json'].includes(e.target.value);
    card.querySelector('.rules-panel').style.display = isRuleType ? 'block' : 'none';
    if (isRuleType) {
         card.querySelector('.rule-desc').innerHTML = e.target.value === 'json' 
           ? '* <b>JSON格式</b>：属性路径。支持过滤如 <code>root | tags=Math</code>。拼接URL如 <code>"https..." + slug</code>。' 
           : '* <b>HTML格式</b>：CSS 选择器。支持 <code>-> [attr]</code> 提属性。日期支持宏拼接：<code>{.y}-{.m}</code>。拼接URL：<code>"https://..." + a</code>';
    }
  });

  const methodSelect = card.querySelector('.m-method');
  const payloadRow = card.querySelector('.payload-row');
  methodSelect.addEventListener('change', (e) => {
      payloadRow.style.display = e.target.value === 'POST' ? 'flex' : 'none';
  });

  card.querySelector('.preview-btn').addEventListener('click', async () => {
    const curSource = getSingleSourceFromCard(card);
    if (!curSource.url) return alert("请先填写 URL！");
    
    const pModal = document.getElementById('preview-modal');
    const pLoading = document.getElementById('preview-loading');
    const pList = document.getElementById('preview-list');
    const pHint = document.getElementById('preview-hint');
    
    pModal.style.display = 'flex';
    pList.innerHTML = '';
    pLoading.style.display = 'block';
    pHint.innerText = '';
    
    if (curSource.type === 'html' && !curSource.rules.item) {
        pHint.innerText = '💡 规则为空，正在启动 HTML 嗅探引擎...';
        const inferredRules = await autoInferHTMLRules(curSource);
        if (inferredRules) {
            curSource.rules = inferredRules;
            updateCardFromObject(card, curSource);
            pHint.innerText = `✅ AI 推断成功！已填入选择器 "${inferredRules.item}"`;
        } else {
            pHint.innerText = `⚠️ 推断失败，请手动填写规则。`;
            pLoading.style.display = 'none'; return;
        }
    } else if (curSource.type === 'json' && !curSource.rules.title) {
        pHint.innerText = '💡 规则为空，正在启动 JSON 嗅探引擎...';
        const inferredRules = await autoInferJSONRules(curSource);
        if (inferredRules) {
            curSource.rules = inferredRules;
            updateCardFromObject(card, curSource);
            pHint.innerText = `✅ AI 推断成功！已提取出标准结构，开始抓取...`;
        } else {
            pHint.innerText = `⚠️ JSON 推断失败，请手动填写规则。`;
            pLoading.style.display = 'none'; return;
        }
    }
    
    let items = [];
    if (curSource.type === 'rss') items = await fetchRSS(curSource);
    else if (curSource.type === 'html') items = await fetchHTML(curSource);
    else if (curSource.type === 'json') items = await fetchJSON(curSource);
    
    pLoading.style.display = 'none';
    if (items.length === 0) {
        pList.innerHTML = '<p style="color:red;">❌ 未抓取到有效数据，请检查规则或查看控制台日志。</p>';
    } else {
        pHint.innerText += ` (共解析出 ${items.length} 条有效数据)`;
        pList.innerHTML = items.map(createNewsItemHtml).join('');
    }
  });

  card.querySelector('.btn-export-clip').addEventListener('click', () => {
    const currentConfig = getSingleSourceFromCard(card);
    navigator.clipboard.writeText(JSON.stringify(currentConfig, null, 2))
      .then(() => alert('当前配置已成功复制到剪贴板！'))
      .catch(err => {
         prompt("浏览器拦截了剪贴板权限，请手动复制下方代码：", JSON.stringify(currentConfig));
      });
  });

  card.querySelector('.btn-import-clip').addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        const parsed = JSON.parse(text);
        if (parsed.name !== undefined && parsed.url !== undefined) {
            updateCardFromObject(card, parsed);
            alert('配置覆盖更新成功！');
        } else {
            alert('非合法的新闻源 JSON 对象。');
        }
    } catch(err) {
        const text = prompt("直接粘贴 JSON 代码：");
        if (text) {
           try {
              const parsed = JSON.parse(text);
              if (parsed.name !== undefined) {
                  updateCardFromObject(card, parsed);
                  alert('配置覆盖更新成功！');
              }
           } catch(e) { alert("JSON格式错误"); }
        }
    }
  });
  document.getElementById('manage-list').appendChild(card);
}

function handleFileImport(event) {
  const files = event.target.files;
  if (!files.length) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (file.name.endsWith('.opml') || file.name.endsWith('.xml')) {
        const doc = new DOMParser().parseFromString(content, 'text/xml');
        const outlines = doc.querySelectorAll('outline');
        outlines.forEach(outline => {
          const name = outline.getAttribute('text') || outline.getAttribute('title');
          const xmlUrl = outline.getAttribute('xmlUrl');
          const htmlUrl = outline.getAttribute('htmlUrl'); 
          if (!name) return;
          if (xmlUrl) {
            addManageCard({ name: name, url: xmlUrl, homepage: htmlUrl || '', type: 'rss', tags: ['导入标签'] }, document.querySelectorAll('.source-card').length);
          }
        });
      }
    };
    reader.readAsText(file);
  });
}

function collectSourcesFromUI() {
  const cards = document.querySelectorAll('.source-card');
  const newSources = [];
  cards.forEach(card => { newSources.push(getSingleSourceFromCard(card)); });
  return newSources;
}

function saveSourcesToLocal() {
  const newSources = collectSourcesFromUI();
  const limit = parseInt(document.getElementById('global-display-limit').value, 10) || 1;
  
  const token = document.getElementById('gh-token').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const path = document.getElementById('gh-path').value.trim() || 'news_data.json';
  
  const newGithubConfig = { token, repo, path };

  AppStorage.set({ 
      customSources: newSources, 
      displayLimit: limit,
      githubConfig: newGithubConfig
  }).then(() => {
    alert('设置已成功保存！'); location.reload(); 
  });
}

function exportSources() {
  const newSources = collectSourcesFromUI();
  const blob = new Blob([JSON.stringify(newSources, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sources.json'; a.click();
}

function resetSources() {
  if (!confirm('确定恢复为扩展初始默认配置吗？')) return;
  AppStorage.remove(['customSources']).then(() => { alert('已恢复默认配置！'); location.reload(); });
}

function handleJsonImport(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed) && confirm(`检测到 ${parsed.length} 条配置，确认覆盖？`)) {
           AppStorage.set({ customSources: parsed }).then(() => { alert('JSON 导入成功！'); location.reload(); });
      }
    } catch (err) { alert('JSON 解析失败。'); }
  };
  reader.readAsText(file);
}

function pasteJsonConfig() {
  const code = prompt("注意：这会覆盖当前所有配置，请粘贴 JSON 代码："); if (!code) return;
  try {
    const parsed = JSON.parse(code);
    if (Array.isArray(parsed)) {
       AppStorage.set({ customSources: parsed }).then(() => { alert('配置导入成功！'); location.reload(); });
    }
  } catch(err) { alert('JSON 解析失败。'); }
}
