// index.js
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
    cacheHit: false  // 添加缓存命中标识
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
      } else if (section.startsWith('•') || section.startsWith('-')) {
        // 列表项
        formatted.push({
          type: 'list-item',
          content: processMarkdown(section.replace(/^[•-]\s*/, '').trim()),
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
    // 移除常见的语气词、标点符号等
    const cleanText = text.replace(/[，。！？、；：""''（）]/g, ' ')
      .replace(/[a-zA-Z]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // 分词并过滤掉停用词
    const stopWords = ['我', '有', '是', '在', '了', '的', '得', '着', '和', '与', '及', '或'];
    const words = cleanText.split(' ').filter(word => 
      word.length >= 2 && !stopWords.includes(word)
    );
    
    return words;
  },

  // 计算文本相似度
  calculateSimilarity(keywords1, keywords2) {
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  },

  // 检查缓存
  checkCache(keywords) {
    try {
      const cache = wx.getStorageSync('adviceCache') || [];
      
      // 查找最相似的缓存项
      let bestMatch = null;
      let highestSimilarity = 0;
      
      for (const item of cache) {
        const similarity = this.calculateSimilarity(keywords, item.keywords);
        if (similarity > highestSimilarity && similarity > 0.7) { // 相似度阈值
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

  // 重试函数
  async retryRequest(requestFn, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        // 如果不是最后一次尝试，等待后重试
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    throw lastError;
  },

  // 请求函数
  makeRequest() {
    return new Promise((resolve, reject) => {
      wx.request({
        url: 'https://api.deepseek.com/v1/chat/completions',
        method: 'POST',
        timeout: 60000, // 增加到60秒
        data: {
          model: "deepseek-chat",
          messages: [
            {
              "role": "system", 
              "content": "你是一个专业的营养师和中医师。用户会描述他们的症状，你需要给出专业的饮食建议。请按以下格式回复：\n1. 症状分析\n[分析内容]\n\n2. 推荐食物\n• [食物1]: [功效说明]\n• [食物2]: [功效说明]\n• [食物3]: [功效说明]\n\n3. 禁忌食物\n• [食物1]: [原因]\n• [食物2]: [原因]\n• [食物3]: [原因]\n\n4. 饮食注意事项\n[具体建议]"
            },
            {
              "role": "user", 
              "content": this.data.inputText
            }
          ],
          stream: false
        },
        header: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-ff86ef1135be4d00a5fdec0706255f33'
        },
        success: resolve,
        fail: reject
      });
    });
  },

  // 修改获取建议函数
  async getDietAdvice() {
    if (this.data.loading) return;
    
    const keywords = this.extractKeywords(this.data.inputText);
    const cachedResult = this.checkCache(keywords);
    
    if (cachedResult) {
      // 使用缓存的结果
      this.setData({ 
        loading: true,
        cacheHit: true,
        loadingProgress: 0
      });

      // 模拟加载进度
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 20;
        if (progress <= 100) {
          this.setData({ loadingProgress: progress });
        } else {
          clearInterval(progressInterval);
          
          // 显示缓存结果
          const formattedContent = this.formatContent(cachedResult.content);
          formattedContent.forEach(section => {
            section.displayContent = '';
          });
          
          this.setData({ 
            formattedContent,
            loading: false,
            loadingText: ''
          }, () => {
            // 开始打字机效果
            this.typeWriter(formattedContent);
            
            // 显示缓存提示
            wx.showToast({
              title: '已从缓存加载',
              icon: 'none',
              duration: 2000
            });
          });
        }
      }, 100);
    } else {
      // 没有缓存，发起API请求
      this.setData({ 
        loading: true,
        cacheHit: false,
        advice: '',
        formattedContent: [],
        loadingProgress: 0
      });

      this.loadingCount = 0;
      this.loadingTimer = setInterval(() => this.updateLoadingText(), 500);
      
      try {
        const res = await this.retryRequest(() => this.makeRequest());
        console.log('API响应:', res);
        if (res.statusCode === 200 && res.data.choices && res.data.choices[0]) {
          // 设置进度为100%
          this.setData({ loadingProgress: 100 });
          
          const content = res.data.choices[0].message.content;
          
          // 保存到缓存
          this.saveToCache(
            this.data.inputText,
            keywords,
            content
          );
          
          const formattedContent = this.formatContent(content);
          
          // 初始化显示内容
          formattedContent.forEach(section => {
            section.displayContent = '';
          });
          
          this.setData({ formattedContent }, () => {
            // 开始打字机效果
            this.typeWriter(formattedContent);
          });
          
          clearInterval(this.loadingTimer);
          setTimeout(() => {
            this.setData({ 
              loading: false,
              loadingText: '',
              loadingProgress: 0
            });
          }, 300);
        } else {
          clearInterval(this.loadingTimer);
          console.error('API错误:', res.data);
          wx.showToast({
            title: '获取建议失败，请重试',
            icon: 'none',
            duration: 3000
          });
          this.setData({ 
            loading: false,
            loadingText: '',
            loadingProgress: 0
          });
        }
      } catch (error) {
        clearInterval(this.loadingTimer);
        console.error('请求失败:', error);
        wx.showToast({
          title: '网络请求失败，请稍后重试',
          icon: 'none',
          duration: 3000
        });
        this.setData({ 
          loading: false,
          loadingText: '',
          loadingProgress: 0
        });
      }
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
  }
});
