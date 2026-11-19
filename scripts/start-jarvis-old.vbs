' Starts JARVIS (the old one) without a console window: runs scripts\launch-old.js hidden. The "Start JARVIS Old" shortcut points here.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here & "\.."
sh.Run "node """ & here & "\launch-old.js""", 0, False
