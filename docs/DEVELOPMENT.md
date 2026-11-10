# 维护与开发

普通用户不用运行本页的命令，直接下载Release安装包并按[安装教程](INSTALL.md)使用。

## 项目结构

根目录的 `manifest.json`、JS和HTML就是可直接加载的扩展，没有打包工具或运行时依赖。

- `content.js`：YouTube页面中的面板、样式弹窗与字幕层。
- `service-worker.js`：设置、字幕获取调度、下载和浏览器后台入口。
- `source.js`、`capture.js`：YouTube当前可访问字幕的获取。
- `offscreen.*`、`worker.js`：浏览器内部的翻译线程。
- `core.js`：逐词映射、结构校验、SRT解析/输出等。
- `store.js`：本地任务缓存。
- `settings.*`：首次配置和高级排错。
- `help.*`：离线使用教程。
- `sentence-prompt.txt`：分句翻译规则。
- `docs/`：用户与维护者教程；`samples/`：原创教学字幕。

## 本地检查

维护者安装Node.js后，在项目根目录运行：

```text
npm run check
npm test
```

没有npm依赖，不需要 `npm install`。核心测试只使用原创合成字幕，不连接模型、不消耗API余额。浏览器界面测试还应手动检查总开关跨页面同步与持久化、关闭后暂停后续批次、重新开启需手动继续、“显示字幕”只控制显示，以及暗色背景、两个字幕页签、全屏、字号比例和多个标签页的目标选择。

## 重新打包

维护者安装Python3后，在根目录运行：

```text
python scripts/package.py
```

输出在 `dist/`：用户安装ZIP、GitHub源码ZIP和校验值。安装ZIP根目录直接包含清单，不再套 `extension` 子目录。脚本采用文件白名单，不读取API密钥、浏览器资料或私人工作目录。

用户安装扩展不需要Node.js或Python；这些只用于维护者检查与制作发布文件。

## 修改时留意

1. 更新 `manifest.json` 和 `package.json` 中的版本号，以及发布说明。
2. 修改翻译规则或缓存结构时，评估是否需要增加 `core.js` 中的RULE_VERSION，避免把旧结果当成新规则的输出。
3. 不把API Key写入代码、配置、截图或Issue；本地密钥只由用户在扩展设置中输入。
4. 不把完整视频字幕、模型分析或浏览器资料作为测试素材公开；使用原创合成案例。
5. 字幕的句末标点是结构检查，不能证明语义完整；数字、快捷键和专业术语仍需对照原文。
6. 使用YouTube未公开稳定的网页/播放器接口，接口变动可能导致获取失败，不承诺覆盖任意视频。

当前没有GitHub Actions自动发布流程，也不会因为上传代码而自动替你创建或发布Release。按[发布教程](PUBLISH_GITHUB.md)在网页操作即可。
