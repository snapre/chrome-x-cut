# Social Photo Saver

一个本地 Chrome MV3 扩展，用来在 X、Threads 和 Instagram 图片页面一键保存原图。

它分两档能力：

- 纯浏览器扩展：把当前原图保存到 Chrome 下载目录里的 `X Images/` 文件夹。
- 扩展 + native helper：先把图片下载到临时文件，再通过 AppleScript 导入 macOS Photos app，默认导入后删除中间文件。Chrome 扩展本身不能直接写入 Photos 图库，所以这一步必须依赖本机 helper。当前默认模式是 Photos app；helper 不可用时会提示错误，不会静默回退到下载目录。

Photos 模式会读取当前图库中的普通相册并提供下拉选择。选择“Photos 图库（不指定相册）”时，图片只导入图库；选择普通相册时，扩展按相册唯一 ID 导入，因此重名相册也不会混淆。图片即使加入相册也仍属于 Photos 图库，相册只是额外的组织方式。

## 安装扩展

1. 打开 `chrome://extensions/`。
2. 开启 Developer mode。
3. 点击 Load unpacked，选择这个仓库目录：`/Users/snapre/Documents/chrome-x-cut`。
4. 打开 X、Threads 或 Instagram 的图片页面，鼠标移到图片上，左上角会出现 `Cut` 按钮。

也可以点扩展图标里的“保存当前原图”，或在图片上右键选择 `Save original social photo`。

## 导入 Photos app

如果只需要下载到本地，不需要做这一步。

1. 在 `chrome://extensions/` 里复制这个扩展的 ID。
2. 在本仓库运行：

```bash
EXTENSION_ID=<你的扩展 ID> scripts/install-native-host.sh
```

这会把 helper 安装到 `~/Library/Application Support/XPhotoSaver/`，并把 Chrome native messaging manifest 写到 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`。

3. 重新加载扩展。
4. 点扩展图标，把“保存方式”改成 `Photos app`。
5. 在“Photos 相册”下拉框中选择目标相册；新建、重命名或删除相册后可点击“刷新”。
6. 第一次导入时，macOS 可能会弹出 Photos/Automation 权限确认。

如果 native helper 不可用，扩展会显示错误。需要下载到本地时，可以在扩展弹窗里把“保存方式”改成 `下载目录`；需要同时保留一份文件时，勾选“导入 Photos 后保留本地文件”。

如果已经选择的相册后来被删除，保存会明确提示相册不存在。点击扩展弹窗中的“刷新”，重新选择一个相册即可。

## 使用

- 打开 X 的 `/status/.../photo/1`、Threads 的 `/post/.../media` 或 Instagram 的 `/p/...` 图片页面。
- 把鼠标移到图片上并点击 `Cut`，图片入队后可以马上继续 Cut。
- 快捷键：`Alt+Shift+S`。

保存任务按顺序在后台执行，并沿用入队时的保存设置。下载模式自动写入下载目录。真正保存成功后，原页面可见时会播放烟花。点开扩展可以查看队列和最近 100 条成功记录，失败可单独重试。对于保存中断且结果未知的任务，请先检查保存位置，再决定是否重试。关闭页面或弹窗不影响任务，重启 Chrome 后会继续处理待保存任务。

扩展会把 `pbs.twimg.com/media/...&name=small` 这类地址转换为 `name=orig`，尽量保存 X 提供的原图版本。Threads 和 Instagram 使用页面实际提供的 Meta CDN 图片地址，并完整保留其中的临时签名参数。

## 卸载 native helper

```bash
scripts/uninstall-native-host.sh
```

## 验证

```bash
npm test
```

## 边界

- X、Threads 或 Instagram 前端 DOM 变更后，页面浮动按钮的图片识别逻辑可能需要更新。
- Photos 导入依赖 macOS 的 `osascript` 和 Photos app 权限。
- native helper 只接受 `https://pbs.twimg.com/media/`、`cdninstagram.com` 和 `fbcdn.net` 官方图片 CDN URL，不会下载任意网页地址。
