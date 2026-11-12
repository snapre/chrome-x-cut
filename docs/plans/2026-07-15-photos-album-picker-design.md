# Photos 相册读取选择设计

## 目标与取舍

扩展弹窗不再要求用户手填相册名，而是在 Photos 模式下读取当前 macOS Photos 图库中的普通相册并提供下拉选择。下拉首项为“Photos 图库（不指定相册）”，并提供刷新按钮。读取失败时保留图库选项并显示可重试错误。

采用“相册 ID + 显示名称”方案。仅按名称导入无法区分重名相册；构建完整文件夹树则增加较多复杂度且不是当前需求。Photos 脚本字典提供普通相册的唯一 ID，因此 native helper 返回 `{id, name}` 列表，弹窗显示名称但存储 ID，保存时按 ID 查找目标相册。

## 数据流与安全

弹窗通过扩展后台发送 `listAlbums` native message。本机 helper 使用 JXA 读取 Photos 普通相册的 ID 和名称，解析、校验并排序后返回。相册列表只保留在弹窗内存中；同步设置仅保存用户选中的 `albumId` 和 `albumName`，不会写入 helper 日志或发送到网络。

保存图片时，后台把选中的相册 ID 和名称传给 helper。helper 使用独立的 `osascript` 参数按 ID 查找相册并导入；如果相册已经被删除，则明确报错并提示用户刷新选择，不自动创建同名相册。未选择相册时继续只导入 Photos 图库。

## 验证

Python 测试覆盖相册列表 JSON 解析、排序、按 ID 导入和空选择导入；AppleScript/JXA 编译测试验证脚本语法。扩展继续运行 JavaScript 语法检查和完整 `npm test`，随后重新安装 native helper，并实际验证能够读取相册数量而不输出名称。

