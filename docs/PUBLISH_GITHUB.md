# 不写命令，上传GitHub并发布安装包

这篇给项目维护者看。普通用户只看[安装教程](INSTALL.md)。

你会拿到两份ZIP：

| 文件 | 用来做什么 |
|---|---|
| `YIHAO-Translator-GitHub-v0.1.4.zip` | 解压后，把里面的源码和教程上传到GitHub仓库。 |
| `YIHAO-Translator-v0.1.4.zip` | 原样作为Release附件发布，给用户下载安装。 |

两份都不含你的密钥。**不要上传原来的整个工作文件夹**，其中可能有个人配置和实验资料。

## 第一步：在网页创建仓库

1. 打开 [GitHub](https://github.com/)，用你自己的账号登录。
2. 点击页面右上角的“+”，选择 **New repository**。
3. Repository name可填 `yihao-translator`。说明可复制：`在YouTube页面内生成整句中文或双语字幕的Chrome扩展，带中文新手教程。`
4. 选择 **Public** 表示公开。先不要额外勾选生成README、.gitignore或许可证：准备好的源码包已包含前两者；你当前选择暂不添加开源许可证。
5. 点击 **Create repository**。这只是创建空仓库，接着上传文件。

## 第二步：上传源码，而不是只上传ZIP

1. 先把 **GitHub源码包** 全部解压。
2. 打开解压目录，直到同时能看到 `README.md`、`manifest.json`、`content.js`、`docs` 等文件。
3. 回到GitHub空仓库，点击 **uploading an existing file**；已有文件的仓库可点 **Add file → Upload files**。
4. 将这层目录中的**所有文件和子文件夹**拖入网页，包括 `.github`、`.gitignore`、`NOTICE.md`，保留目录结构。不要拖外面那层总文件夹，也不要只上传ZIP。
5. 等文件列表出现，提交说明填 `上传0.1.4测试版与中文教程`，点击 **Commit changes**。
6. 提交后，仓库首页应直接显示 `README.md` 和 `manifest.json`，README下面能正常显示图片与教程链接。如果首页只有一个总文件夹，说明多套了一层。

GitHub网页一次最多上传100个文件、单个文件最多25MiB；本项目已按小体积、少文件整理，通常一次即可上传。官方步骤见[上传文件](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)。

## 第三步：给普通用户发布安装附件

1. 在仓库首页找到 **Releases**，点击 **Draft a new release**。
2. 新建标签 **v0.1.4**，Target选包含你刚才文件的分支。
3. 标题填 `v0.1.4 · YIHAO 翻译器测试版`。
4. 描述可以使用本项目的 [RELEASE_NOTES.md](../RELEASE_NOTES.md)。
5. 把**用户安装包** `YIHAO-Translator-v0.1.4.zip` 拖进附件区域。不是GitHub源码包，也不是包含你个人资料的文件夹。
6. 建议勾选 **This is a pre-release**，因为自动获取字幕仍在验证。检查附件、说明和版本号，再点击 **Publish release**。

发布后，你会看到自己上传的ZIP，以及GitHub自动生成的Source code附件。教程中请引导普通用户优先下载你上传的ZIP。

官方参考：[创建仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)、[发布版本](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## 第四步：发给别人之前，自测一次

1. 从你的GitHub Release重新下载ZIP，而不是使用电脑上旧目录。
2. 全部解压，检查根目录直接有 `manifest.json`，并按教程加载。
3. 使用自己的DeepSeek密钥，先在普通YouTube视频上测试。自动取字幕失败时，按FAQ检查当前会话，不要宣传“所有视频都能一键翻译”。
4. 试一下“启用翻译”总开关：关闭后自定义字幕隐藏、原生字幕恢复；其他已打开的视频同步关闭。刷新后状态仍保留，再开启不会自动继续翻译。再检查“显示字幕”只控制显示、背景开关、两种字幕样式与SRT下载。
5. 确认README图片能显示、链接能打开、安装包里没有密钥或私人文件。

## 以后更新

修改代码后更新 `manifest.json` 的版本号，重新打包，创建新的标签和Release。不要把新代码套上旧版本号给用户。普通用户按[更新教程](UPDATE.md)覆盖原来的已加载目录。

维护者可用 `python scripts/package.py` 重新制作两份ZIP；只有重新打包的人需要Python，安装使用插件的人不需要。也可继续让协作者帮你打包，无需先学习命令行。
