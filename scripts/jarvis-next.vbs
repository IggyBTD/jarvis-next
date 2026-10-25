' Starts JARVIS NEXT without a console window flashing: runs scripts\launch-app.js hidden. The shortcut points here.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here & "\.."
sh.Run "node """ & here & "\launch-app.js""", 0, False
