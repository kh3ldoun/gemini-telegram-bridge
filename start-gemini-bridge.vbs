Set WshShell = CreateObject("WScript.Shell")
' Run the bridge silently (0 means hidden window)
' We use the full path to bun.cmd and the bridge.ts file
WshShell.Run "C:\Users\w_kha\AppData\Roaming\npm\bun.cmd run C:\Users\w_kha\Desktop\gemini-telegram-bridge\bridge.ts", 0
Set WshShell = Nothing
