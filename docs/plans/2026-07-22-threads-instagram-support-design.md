# Threads / Instagram 图片保存支持

## 目标

在不削弱现有 URL 安全校验的前提下，让扩展在 X、Threads 和 Instagram 的图片上显示 `Cut` 按钮，并支持下载目录与 macOS Photos 两种现有保存方式。

## 方案

URL 工具层新增统一的媒体规范化入口。X 图片继续把 `pbs.twimg.com/media/` URL 转为 `name=orig`；Threads 和 Instagram 图片只允许来自 Meta 官方图片 CDN（`cdninstagram.com`、`fbcdn.net`），并完整保留有时效签名的查询参数。页面 URL 用于识别平台与帖子短码，生成 `x-*`、`threads-*` 或 `instagram-*` 文件名。

页面脚本继续从实际渲染的 `img.currentSrc`、`srcset` 和样式中寻找媒体，但扩展候选 URL 识别范围，并从 X 的 status 链接扩展到 Threads 的 post 链接及 Instagram 的 post/reel 链接。Chrome manifest 同步增加页面注入、右键菜单与 CDN 下载权限。

native helper 使用与扩展一致的严格主机白名单：X 仍限制 `/media/` 路径；Meta 图片只接受 HTTPS 且主机必须等于或真正从属于允许的 CDN 后缀，防止相似域名绕过。原有 Photos 导入与相册选择流程不变。

## 验证

单元测试覆盖三个平台的 URL、帖子 ID、文件名和恶意相似域名；完整测试覆盖 JavaScript 语法、Python URL 校验与 Photos AppleScript 编译。最后在实际 Threads/Instagram 页面验证按钮命中与保存请求。
