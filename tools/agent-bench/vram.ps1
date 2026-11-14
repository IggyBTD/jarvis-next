$c=(Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage').CounterSamples | sort CookedValue -desc | select -first 1
[math]::Round($c.CookedValue/1GB,2)
