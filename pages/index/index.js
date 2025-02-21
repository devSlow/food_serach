// index.js
import config from '../../config';

Page({
  data: {
    inputText: '',
    advice: '',
    loading: false,
    loadingText: '',
    loadingProgress: 0,
    formattedContent: [],
    isContentFullyDisplayed: false,
    isTyping: false,  // 添加打字机状态
    cacheHit: false,  // 添加缓存命中标识
    showHistory: false, // 添加历史记录显示状态
    historyList: [], // 添加历史记录列表
    lastRequestTime: null,
    showNotice: false, // 添加公告显示状态
  },

  onInput(e) {
    this.setData({
      inputText: e.detail.value
    });
  },

  updateLoadingText() {
    const dots = '.'.repeat(this.loadingCount % 4);
    const progress = Math.min(95, this.data.loadingProgress + Math.random() * 15);
    this.setData({
      loadingText: '正在分析' + dots,
      // 确保进度为整数
      loadingProgress: Math.floor(progress)
    });
    this.loadingCount++;
  },

  // 格式化内容
  formatContent(content) {
    const sections = content.split('\n');
    const formatted = [];
    
    // 处理 Markdown 格式的辅助函数
    const processMarkdown = (text) => {
      return text
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/__(.*?)__/g, '<u>$1</u>')
        .replace(/~~(.*?)~~/g, '<del>$1</del>')
        .replace(/==(.*?)==/g, '<mark>$1</mark>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #007AFF;">$1</a>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\{([^}]+)\}\(([\w#]+)\)/g, '<span style="color: $2;">$1</span>');
    };
    
    sections.forEach((section, index) => {
      if (section.startsWith('1.') || section.startsWith('2.') || 
          section.startsWith('3.') || section.startsWith('4.')) {
        // 主标题
        formatted.push({
          type: 'title',
          content: processMarkdown(section.trim()),
          style: '' // 初始样式为空
        });
      } else if (section.match(/^\s*[•\[\-]\s*\[.*?\]:/)) {
        // 匹配 [食物]: 格式或 • [食物]: 格式
        const cleanSection = section.replace(/^\s*[•\[\-]\s*/, '');
        formatted.push({
          type: 'list-item',
          content: processMarkdown(cleanSection.trim()),
          style: '' // 初始样式为空
        });
      } else if (section.match(/^\s*[•\-]\s*/)) {
        // 匹配普通列表项
        const cleanSection = section.replace(/^\s*[•\-]\s*/, '');
        formatted.push({
          type: 'list-item',
          content: processMarkdown(cleanSection.trim()),
          style: '' // 初始样式为空
        });
      } else if (section.trim()) {
        // 普通文本
        formatted.push({
          type: 'text',
          content: processMarkdown(section.trim()),
          style: '' // 初始样式为空
        });
      }
    });

    return formatted;
  },

  // 打字机效果
  async typeWriter(formattedContent) {
    this.setData({ 
      isContentFullyDisplayed: false,
      isTyping: true
    });
    
    let currentSectionIndex = 0;
    let currentCharIndex = 0;
    
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    while (currentSectionIndex < formattedContent.length) {
      const section = formattedContent[currentSectionIndex];
      
      if (currentCharIndex === 0) {
        section.displayContent = '';
        this.setData({
          formattedContent: [...formattedContent]
        });
        await sleep(50); // 减少初始延迟
      }
      
      if (section.type === 'text' && section.content === '<br/>') {
        // 空行直接显示
        section.displayContent = section.content;
        section.style = ''; // 空行不需要样式
        currentSectionIndex++;
        currentCharIndex = 0;
        this.setData({
          formattedContent: [...formattedContent]
        });
        await sleep(50);
      } else if (currentCharIndex < section.content.length) {
        // 先显示文字
        section.displayContent = section.content.slice(0, currentCharIndex + 1);
        if (currentCharIndex === section.content.length - 1) {
          // 文字显示完后添加样式
          section.style = section.type + '-section visible';
        }
        this.setData({
          formattedContent: [...formattedContent]
        });
        currentCharIndex++;
        await sleep(30);
      } else {
        currentSectionIndex++;
        currentCharIndex = 0;
        await sleep(100); // 减少段落间停顿
      }
    }
    
    this.setData({ 
      isContentFullyDisplayed: true,
      isTyping: false
    });
  },

  // 提取关键词
  extractKeywords(text) {
    // 移除标点和特殊字符
    const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // 更新停用词列表
    const stopWords = new Set(['我', '有', '是', '在', '了', '的', '得', '着', '和', '与', '及', '或', '请', '帮', '我要', '想要', '需要']);
    
    // 分词并过滤
    return cleanText.split(' ')
      .filter(word => 
        word.length >= 2 && 
        !stopWords.has(word) &&
        !/^\d+$/.test(word) // 过滤纯数字
      )
      .slice(0, 5); // 只取前5个关键词
  },

  // 计算文本相似度
  calculateSimilarity(keywords1, keywords2) {
    if (!keywords1 || !keywords2) return 0;
    
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / Math.min(set1.size, set2.size); // 使用最小集合大小作为分母
  },

  // 检查缓存
  checkCache(keywords) {
    try {
      const cache = wx.getStorageSync('adviceCache') || [];
      let bestMatch = null;
      let highestSimilarity = 0;
      
      // 只检查最近的20条缓存
      const recentCache = cache.slice(0, 20);
      
      for (const item of recentCache) {
        const similarity = this.calculateSimilarity(keywords, item.keywords);
        if (similarity > highestSimilarity && similarity > 0.6) { // 降低相似度阈值
          highestSimilarity = similarity;
          bestMatch = item;
        }
      }
      
      return bestMatch;
    } catch (e) {
      console.error('读取缓存失败:', e);
      return null;
    }
  },

  // 保存到缓存
  saveToCache(question, keywords, content) {
    try {
      const cache = wx.getStorageSync('adviceCache') || [];
      const maxCacheSize = 50; // 最大缓存条数
      
      // 添加新缓存项
      cache.unshift({
        question,
        keywords,
        content,
        timestamp: Date.now()
      });
      
      // 如果超出最大缓存数，删除最旧的
      if (cache.length > maxCacheSize) {
        cache.pop();
      }
      
      wx.setStorageSync('adviceCache', cache);
    } catch (e) {
      console.error('保存缓存失败:', e);
    }
  },

  // 修改文本预处理函数
  preprocessInput(text) {
    // 1. 去除多余空格和换行
    text = text.replace(/\s+/g, ' ').trim();
    
    // 2. 限制文本长度
    if (text.length > 500) {
      text = text.slice(0, 500);
      wx.showToast({
        title: '输入内容已超过500字，已自动截断',
        icon: 'none',
        duration: 2000
      });
    }

    // 3. 提取症状关键词
    const symptoms = this.extractSymptoms(text);
    if (symptoms.length === 0) {
      // 如果没有找到具体症状，使用分词提取关键词
      const keywords = this.extractKeywords(text);
      return `请针对以下情况提供饮食建议：${keywords.join('，')}`;
    }

    // 4. 提取身体状况
    const conditions = this.extractConditions(text);
    
    // 5. 重组查询文本，更简洁明确
    let query = `请针对`;
    if (symptoms.length > 0) {
      query += `${symptoms.join('，')}`;
    }
    if (conditions.length > 0) {
      query += `，同时考虑${conditions.join('，')}的情况`;
    }
    query += `提供饮食建议。`;

    return query;
  },

  // 优化症状关键词提取
  extractSymptoms(text) {
    const symptoms = [];
    
    // 扩展症状关键词，改用数组形式
    const symptomKeywords = [
      // 疼痛类
      '疼', '痛', '酸', '胀', '不适',
      // 消化类
      '恶心', '呕吐', '腹泻', '便秘', '胃痛', '反酸',
      // 呼吸类
      '咳嗽', '咳', '喘', '气短',
      // 体温类
      '发烧', '发热', '低烧', '高烧',
      // 神经类
      '头晕', '头痛', '失眠', '眩晕', '疲劳', '乏力',
      // 心血管类
      '心慌', '胸闷', '心悸',
      // 其他症状
      '出汗', '浮肿', '口干', '口苦'
    ];
    
    // 遍历关键词数组
    symptomKeywords.forEach(keyword => {
      const regex = new RegExp(`[^，。！？；,!?;]*${keyword}[^，。！？；,!?;]*`, 'g');
      const matches = text.match(regex);
      if (matches) {
        // 提取最短的匹配项，避免重复冗长
        const shortestMatch = matches.reduce((shortest, current) => 
          current.length < shortest.length ? current : shortest
        );
        symptoms.push(shortestMatch.trim());
      }
    });

    // 去重并限制数量，优先保留较短的描述
    return [...new Set(symptoms)]
      .sort((a, b) => a.length - b.length)
      .slice(0, 2);
  },

  // 提取身体状况关键词
  extractConditions(text) {
    const conditions = [];
    
    // 常见状况关键词
    const conditionKeywords = ['怀孕', '月经', '哺乳', '高血压', '糖尿病', '过敏', 
      '胃病', '心脏病', '肝病', '肾病', '感冒', '发烧'];
    
    conditionKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        conditions.push(keyword);
      }
    });

    return conditions;
  },

  // 修改请求函数
  makeRequest() {
    // 预处理输入文本
    const processedInput = this.preprocessInput(this.data.inputText);
    
    const requestData = {
      model: config.MODEL,
      messages: [
        {
          "role": "system",
          "content": "你是一个营养顾问和专业医师。用通俗的语言回答用户的饮食问题。格式：\n1. 症状分析\n[简要分析]\n\n2. 推荐食物\n• [食物1]: [功效]\n• [食物2]: [功效]\n• [食物3]: [功效]\n\n3. 禁忌食物\n• [食物1]: [原因]\n• [食物2]: [原因]\n\n4. 饮食注意事项\n[要点]"
        },
        {
          "role": "user",
          "content": processedInput
        }
      ],
      stream: false,
      temperature: config.TEMPERATURE,
      max_tokens: config.MAX_TOKENS,
      presence_penalty: -0.5
    };

    return new Promise((resolve, reject) => {
      wx.request({
        url: config.API_ENDPOINT,
        method: 'POST',
        timeout: 180000, // 增加到3分钟
        data: requestData,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.API_KEY}`
        },
        success: (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP 错误: ${res.statusCode}`));
            return;
          }
          if (!res.data || !res.data.choices) {
            reject(new Error('无效的 API 响应格式'));
            return;
          }
          let content;
          if (res.data.choices && res.data.choices[0]) {
            content = res.data.choices[0].message.content;
            console.log('API 返回内容:', content);
          } else {
            console.error('无法解析的响应格式:', res.data);
            throw new Error('无法解析的 API 响应格式');
          }
          resolve(res);
        },
        fail: (error) => {
          console.error('API 请求失败:', error);
          reject(new Error(error.errMsg || '网络请求失败'));
        }
      });
    });
  },

  // 修改重试函数
  async retryRequest(maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`开始第 ${i + 1} 次请求尝试，当前时间:`, new Date().toLocaleString());
        
        const result = await Promise.race([
          this.makeRequest(),
          new Promise((_, reject) => 
            // 增加超时时间到60秒
            setTimeout(() => reject(new Error('API 请求超时')), 60000)
          )
        ]);
        console.log('API 请求成功');
        return result;
      } catch (error) {
        lastError = error;
        console.error(`第 ${i + 1} 次请求失败:`, error);
        
        if (i < maxRetries - 1) {
          // 增加等待时间，使用更长的指数退避
          const waitTime = Math.min(120000, 10000 * Math.pow(2, i)); // 最长等待2分钟
          console.log(`等待 ${waitTime/1000}秒后重试，当前时间:`, new Date().toLocaleString());
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    console.error(`请求失败，最大重试次数 ${maxRetries}，最后一次错误:`, lastError);
    throw new Error(`请求失败，已重试${maxRetries}次：${lastError.errMsg || '未知错误'}`);
  },

  // 修改获取建议函数
  async getDietAdvice() {
    const now = Date.now();
    const lastRequestTime = this.data.lastRequestTime || 0;
    if (now - lastRequestTime < 3000) { // 3秒内不允许重复请求
      wx.showToast({
        title: '请求太频繁，请稍后再试',
        icon: 'none'
      });
      return;
    }
    this.data.lastRequestTime = now;

    if (this.data.loading) {
      console.log('已在加载中，忽略请求');
      return;
    }
    
    // 检查输入是否为空
    if (!this.data.inputText.trim()) {
      console.log('输入为空，显示提示');
      wx.showToast({
        title: '请输入症状描述',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    console.log('开始请求，输入内容:', this.data.inputText);
    console.log('当前时间:', new Date().toLocaleString());

    const keywords = this.extractKeywords(this.data.inputText);
    console.log('提取的关键词:', keywords);
    
    const cachedResult = this.checkCache(keywords);
    console.log('缓存检查结果:', cachedResult ? '命中缓存' : '未命中缓存');
    
    this.setData({ loading: true, loadingProgress: 0 });
    this.loadingCount = 0;
    this.loadingTimer = setInterval(() => this.updateLoadingText(), 500);

    try {
      if (cachedResult) {
        console.log('使用缓存内容:', cachedResult);
        this.setData({ cacheHit: true });
        
        // 使用缓存内容
        const formattedContent = this.formatContent(cachedResult.content);
        console.log('格式化后的缓存内容:', formattedContent);
        
        formattedContent.forEach(section => {
          section.displayContent = '';
        });
        
        this.setData({ formattedContent }, () => {
          this.typeWriter(formattedContent);
        });

        this.saveHistory(this.data.inputText, cachedResult.content);
      } else {
        console.log('开始 API 请求流程');
        
        const response = await this.retryRequest();
        console.log('API 完整响应:', response);

        if (response.statusCode === 200 && response.data) {
          let content;
          if (response.data.choices && response.data.choices[0]) {
            content = response.data.choices[0].message.content;
            console.log('API 返回内容:', content);
          } else {
            console.error('无法解析的响应格式:', response.data);
            throw new Error('无法解析的 API 响应格式');
          }

          if (!content) {
            throw new Error('API 返回的内容为空');
          }
          
          // 保存到缓存
          this.saveToCache(
            this.data.inputText,
            keywords,
            content
          );

          // 格式化并显示内容
          const formattedContent = this.formatContent(content);
          formattedContent.forEach(section => {
            section.displayContent = '';
          });
          
          this.setData({ formattedContent }, () => {
            this.typeWriter(formattedContent);
          });
          
          this.saveHistory(this.data.inputText, content);
        } else {
          throw new Error('API 响应状态码异常或数据为空');
        }
      }
    } catch (error) {
      console.error('请求失败详细信息:', error);
      console.error('错误堆栈:', error.stack);
      wx.showToast({
        title: '获取建议失败，请重试',
        icon: 'none',
        duration: 2000
      });
    } finally {
      clearInterval(this.loadingTimer);
      this.setData({ 
        loading: false,
        loadingProgress: 100
      });
      console.log('请求完成时间:', new Date().toLocaleString());
    }
  },

  // 处理富文本样式的辅助函数
  processStyle(ctx, text, defaultStyle = {}) {
    // 保存当前样式
    const originalStyle = {
      font: ctx.font,
      fillStyle: ctx.fillStyle
    };

    // 处理加粗
    if (text.includes('<b>')) {
      ctx.font = text.includes('title-section') ? 
        'bold 32px sans-serif' : 'bold 28px sans-serif';
    }

    // 处理颜色文本
    const colorMatch = text.match(/color: (#[0-9a-fA-F]{6}|[a-z]+)/);
    if (colorMatch) {
      ctx.fillStyle = colorMatch[1];
    }

    // 应用默认样式
    if (defaultStyle.font) ctx.font = defaultStyle.font;
    if (defaultStyle.fillStyle) ctx.fillStyle = defaultStyle.fillStyle;

    // 返回清理后的文本
    const cleanText = text.replace(/<[^>]+>/g, '');

    return {
      text: cleanText,
      restore: () => {
        ctx.font = originalStyle.font;
        ctx.fillStyle = originalStyle.fillStyle;
      }
    };
  },

  // 修改生成图片的函数
  async saveAsImage() {
    if (!this.data.isContentFullyDisplayed) {
      wx.showToast({
        title: '请等待内容完全显示',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 先检查权限
    try {
      const res = await wx.getSetting();
      if (!res.authSetting['scope.writePhotosAlbum']) {
        await wx.authorize({
          scope: 'scope.writePhotosAlbum'
        });
      }
    } catch (error) {
      wx.showModal({
        title: '提示',
        content: '需要您授权保存图片到相册',
        success: (res) => {
          if (res.confirm) {
            wx.openSetting();
          }
        }
      });
      return;
    }

    wx.showLoading({ title: '正在生成图片...' });
    
    try {
      const query = wx.createSelectorQuery();
      const canvas = await new Promise(resolve => {
        query.select('#shareCanvas')
          .fields({ node: true, size: true })
          .exec((res) => resolve(res[0].node));
      });
      
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      
      // 计算内容总高度
      let totalHeight = 300; // 增加初始高度，为顶部和底部留空间
      const contentMeasure = this.measureContentHeight(ctx, this.data.formattedContent);
      totalHeight += contentMeasure.height;
      
      // 设置单页最大高度
      const maxPageHeight = Math.min(2000, Math.floor(totalHeight * 0.6));
      
      // 设置canvas尺寸
      canvas.width = 750 * dpr;
      canvas.height = maxPageHeight * dpr;
      
      // 辅助函数：绘制圆角矩形
      const roundRect = (ctx, x, y, width, height, radius) => {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
        ctx.lineTo(x + width, y + height - radius);
        ctx.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
        ctx.lineTo(x + radius, y + height);
        ctx.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
        ctx.lineTo(x, y + radius);
        ctx.arc(x + radius, y + radius, radius, Math.PI, -Math.PI / 2);
        ctx.closePath();
      };

      // 设置主题色
      const themeColor = '#007AFF';

      // 设置背景
      ctx.scale(dpr, dpr);
      ctx.fillStyle = themeColor;
      // 减小蓝色边框宽度，从原来的20px减小到10px
      ctx.fillRect(0, 0, 750, canvas.height / dpr);

      // 主体内容卡片位置上移到顶部，增大白色区域
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      // 修改白色区域的位置和大小，减小蓝色边框的显示范围
      roundRect(ctx, 10, 10, 730, canvas.height / dpr - 20, 12);
      ctx.fill();

      // 重置阴影和文本对齐
      ctx.shadowColor = 'transparent';
      ctx.textAlign = 'left';

      // 相应地调整内容区域的位置
      let y = 70; // 调整起始位置

      // 调整标题位置
      ctx.fillStyle = '#333333';
      ctx.font = 'bold 36px sans-serif';
      const titleText = '饮食建议';
      ctx.fillText(titleText, 30, y);
      y += 60;

      // 调整问题区域位置
      ctx.fillStyle = '#F8F9FA';
      roundRect(ctx, 30, y, 690, 80, 8);
      ctx.fill();

      ctx.fillStyle = themeColor; // 使用主题色
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('问题', 60, y + 35);

      ctx.fillStyle = '#666666';
      ctx.font = '28px sans-serif';
      const wrappedQuestion = this.wrapText(ctx, this.data.inputText, 520);
      wrappedQuestion.forEach((line, index) => {
        ctx.fillText(line, 140, y + 35);
      });
      y += 100;

      // 绘制内容
      let isContentFull = true;
      let lastCompleteY = y;
      
      for (const item of this.data.formattedContent) {
        if (y + 100 > maxPageHeight - 120) {
          isContentFull = false;
          break;
        }
        
        if (item.type === 'title') {
          // 标题背景
          ctx.fillStyle = '#F8F9FA';
          roundRect(ctx, 40, y - 10, 670, 60, 8);
          ctx.fill();
          
          // 标题文本
          ctx.font = 'bold 32px sans-serif';
          ctx.fillStyle = '#333333';
          const { text } = this.processStyle(ctx, item.displayContent);
          ctx.fillText(text, 60, y + 30);
          y += 80;
        } else if (item.type === 'list-item') {
          // 列表项背景
          ctx.fillStyle = '#F8F9FA';
          roundRect(ctx, 40, y - 5, 670, 40, 6);
          ctx.fill();
          
          // 圆点
          ctx.beginPath();
          ctx.arc(60, y + 15, 4, 0, Math.PI * 2);
          ctx.fillStyle = themeColor; // 使用主题色
          ctx.fill();
          
          // 文本
          ctx.font = '28px sans-serif';
          ctx.fillStyle = '#666666';
          const { text } = this.processStyle(ctx, item.displayContent);
          ctx.fillText(text, 80, y + 22);
          y += 50;
        } else if (item.type === 'text' && item.displayContent !== '<br/>') {
          ctx.font = '28px sans-serif';
          ctx.fillStyle = '#666666';
          const { text } = this.processStyle(ctx, item.displayContent);
          const wrappedText = this.wrapText(ctx, text, 630);
          wrappedText.forEach(line => {
            ctx.fillText(line, 60, y + 20);
            y += 40;
          });
        } else {
          y += 20;
        }
      }

      // 如果内容被截断，添加提示信息
      if (!isContentFull) {
        const gradientStartY = maxPageHeight - 180;
        const gradient = ctx.createLinearGradient(0, gradientStartY, 0, maxPageHeight - 100);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');
        ctx.fillStyle = gradient;
        ctx.fillRect(20, gradientStartY, 710, 80);

        ctx.fillStyle = '#F8F9FA';
        roundRect(ctx, 40, maxPageHeight - 120, 670, 80, 8);
        ctx.fill();

        // 只保留一行提示文本
        ctx.font = '28px sans-serif';
        ctx.fillStyle = '#666666';
        ctx.textAlign = 'center';
        ctx.fillText('更多内容请使用"膳查查"小程序查看', 375, maxPageHeight - 70);
      }

      // 生成图片并预览
      const tempFilePath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          success: res => resolve(res.tempFilePath),
          fail: reject
        });
      });

      wx.hideLoading();
      
      // 预览图片
      wx.previewImage({
        urls: [tempFilePath],
        success: () => {
          wx.showActionSheet({
            itemList: ['保存到相册'],
            success: async (res) => {
              if (res.tapIndex === 0) {
                wx.showLoading({ title: '保存中...' });
                try {
                  await wx.saveImageToPhotosAlbum({
                    filePath: tempFilePath
                  });
                  wx.hideLoading();
                  wx.showToast({
                    title: '已保存到相册',
                    icon: 'success'
                  });
                } catch (error) {
                  wx.hideLoading();
                  wx.showToast({
                    title: '保存失败',
                    icon: 'none'
                  });
                }
              }
            }
          });
        }
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: '生成图片失败',
        icon: 'none'
      });
      console.error('生成图片失败:', error);
    }
  },

  // 文本换行处理函数
  wrapText(ctx, text, maxWidth) {
    const words = text.split('');
    const lines = [];
    let line = '';
    
    for (const word of words) {
      const testLine = line + word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      lines.push(line);
    }
    return lines;
  },

  // 测量内容高度
  measureContentHeight(ctx, content) {
    let height = 0;
    
    for (const item of content) {
      if (item.type === 'title') {
        const { text } = this.processStyle(ctx, item.displayContent);
        const lines = this.wrapText(ctx, text, 670);
        height += lines.length * 40 + 40; // 标题行高度 + 额外间距
      } else if (item.type === 'list-item') {
        const { text } = this.processStyle(ctx, item.displayContent);
        const lines = this.wrapText(ctx, text, 640);
        height += lines.length * 40;
      } else if (item.type === 'text' && item.displayContent !== '<br/>') {
        const { text } = this.processStyle(ctx, item.displayContent);
        const lines = this.wrapText(ctx, text, 670);
        height += lines.length * 40;
      } else {
        height += 20; // 空行高度
      }
    }
    
    return { height };
  },

  // 添加测量单个项目高度的辅助函数
  measureItemHeight(ctx, item) {
    let height = 0;
    
    if (item.type === 'title') {
      const { text } = this.processStyle(ctx, item.displayContent);
      const lines = this.wrapText(ctx, text, 670);
      height = lines.length * 40 + 40; // 标题行高度 + 额外间距
    } else if (item.type === 'list-item') {
      const { text } = this.processStyle(ctx, item.displayContent);
      const lines = this.wrapText(ctx, text, 640);
      height = lines.length * 40;
    } else if (item.type === 'text' && item.displayContent !== '<br/>') {
      const { text } = this.processStyle(ctx, item.displayContent);
      const lines = this.wrapText(ctx, text, 670);
      height = lines.length * 40;
    } else {
      height = 20; // 空行高度
    }
    
    return height;
  },

  // 在 Page 对象中添加复制方法
  copyContent() {
    if (!this.data.isContentFullyDisplayed) {
      wx.showToast({
        title: '请等待内容完全显示',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 组装要复制的文本
    let copyText = '问题：' + this.data.inputText + '\n\n';
    
    // 添加回答内容
    this.data.formattedContent.forEach(item => {
      const text = item.displayContent.replace(/<[^>]+>/g, '');
      if (item.type === 'title') {
        copyText += '\n' + text + '\n';
      } else if (item.type === 'list-item') {
        copyText += '• ' + text + '\n';
      } else if (item.type === 'text' && text !== '<br/>') {
        copyText += text + '\n';
      }
    });

    // 复制到剪贴板
    wx.setClipboardData({
      data: copyText,
      success: () => {
        wx.showToast({
          title: '复制成功',
          icon: 'success',
          duration: 2000
        });
      },
      fail: () => {
        wx.showToast({
          title: '复制失败',
          icon: 'none',
          duration: 2000
        });
      }
    });
  },

  // 添加清除输入方法
  clearInput() {
    // 判断是否正在加载或打字中
    if (this.data.loading || this.data.isTyping) {
      wx.showToast({
        title: '请等待当前回答完成',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 清除输入内容和结果
    this.setData({
      inputText: '',
      formattedContent: [],
      isContentFullyDisplayed: false,
      isTyping: false
    });
  },

  // 显示历史记录
  showHistory() {
    this.setData({ showHistory: true });
  },

  // 隐藏历史记录
  hideHistory() {
    this.setData({ showHistory: false });
  },

  // 加载历史记录
  loadHistory() {
    const history = wx.getStorageSync('history') || [];
    this.setData({ historyList: history });
  },

  // 保存历史记录
  saveHistory(question, answer) {
    const timestamp = Date.now();
    const timeStr = this.formatTime(new Date());
    const history = wx.getStorageSync('history') || [];
    
    // 检查是否已存在相同问题
    const existingIndex = history.findIndex(item => item.question === question);
    if (existingIndex !== -1) {
      // 如果存在，更新时间和答案
      history[existingIndex].answer = answer;
      history[existingIndex].timestamp = timestamp;
      history[existingIndex].timeStr = timeStr;
    } else {
      // 如果不存在，添加新记录
      history.unshift({
        question,
        answer,
        timestamp,
        timeStr
      });
    }
    
    // 最多保存50条记录
    if (history.length > 50) {
      history.pop();
    }
    
    // 保存到本地存储并更新状态
    wx.setStorageSync('history', history);
    this.setData({ historyList: history });
  },

  // 使用历史记录
  useHistoryItem(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.historyList[index];
    
    // 判断是否正在加载或打字中
    if (this.data.loading || this.data.isTyping) {
      wx.showToast({
        title: '请等待当前回答完成',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    this.setData({
      inputText: item.question,
      showHistory: false
    });

    // 格式化内容并初始化显示
    const formattedContent = this.formatContent(item.answer);
    formattedContent.forEach(section => {
      section.displayContent = '';  // 初始化为空
    });
    
    // 同时保存到缓存中
    const keywords = this.extractKeywords(item.question);
    this.saveToCache(
      item.question,
      keywords,
      item.answer
    );
    
    this.setData({ 
      formattedContent,
      isContentFullyDisplayed: false,
      isTyping: false
    }, () => {
      // 开始打字机效果
      this.typeWriter(formattedContent);
    });
  },

  // 格式化时间
  formatTime(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    
    return `${year}/${month}/${day} ${hour}:${minute < 10 ? '0' + minute : minute}`;
  },

  onLoad() {
    // 加载历史记录
    this.loadHistory();
    
    // 检查是否首次使用
    try {
      // 先尝试清除存储，确保每次都显示公告（测试用）
      // wx.removeStorageSync('hasShownNotice');
      
      const hasShown = wx.getStorageSync('hasShownNotice');
      console.log('是否已显示过公告:', hasShown);
      
      if (!hasShown) {
        // 延迟显示公告，确保页面已完全加载
        setTimeout(() => {
          this.setData({ 
            showNotice: true 
          });
          // 只有在公告成功显示后才保存状态
          try {
            wx.setStorageSync('hasShownNotice', true);
          } catch (err) {
            console.error('保存公告状态失败:', err);
          }
        }, 300);
      }
    } catch (err) {
      console.error('读取公告状态失败:', err);
      // 如果读取失败，也显示公告
      this.setData({ showNotice: true });
    }
  },

  // 清除历史记录
  clearHistory() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有历史记录吗？清空后将无法恢复。',
      confirmColor: '#ff3b30',
      success: (res) => {
        if (res.confirm) {
          // 清空历史记录
          wx.removeStorageSync('history');
          // 清空建议缓存
          wx.removeStorageSync('adviceCache');
          
          // 更新状态
          this.setData({ 
            historyList: [],
            showHistory: false  // 清空后关闭历史记录弹窗
          });
          
          // 显示提示
          wx.showToast({
            title: '已清空全部记录',
            icon: 'success',
            duration: 2000
          });
        }
      }
    });
  },

  // 添加阻止事件冒泡的方法
  preventBubble() {
    return false;
  },

  // 阻止滚动穿透
  preventScroll() {
    return false;
  },

  // 关闭公告
  closeNotice() {
    this.setData({ showNotice: false });
  }
});
