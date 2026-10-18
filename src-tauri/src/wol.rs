// Wake-on-LAN from the desktop app: a browser cannot send UDP, so the "Wake the PC" button calls this.
use std::net::UdpSocket;

/// 6 bytes of 0xFF followed by the MAC address 16 times. Accepts `aa:bb:cc:dd:ee:ff` or `aa-bb-cc-dd-ee-ff`.
pub fn magic_packet(mac: &str) -> Result<Vec<u8>, String> {
    let parts: Vec<&str> = mac.trim().split(|c| c == ':' || c == '-').collect();
    if parts.len() != 6 {
        return Err("a MAC address has six pairs of hex digits, like aa:bb:cc:dd:ee:ff".into());
    }
    let mut bytes = Vec::with_capacity(6);
    for p in parts {
        if p.len() != 2 {
            return Err("a MAC address has six pairs of hex digits, like aa:bb:cc:dd:ee:ff".into());
        }
        bytes.push(u8::from_str_radix(p, 16).map_err(|_| "a MAC address may only contain hex digits".to_string())?);
    }
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&bytes);
    }
    Ok(packet)
}

#[tauri::command]
pub fn wake_on_lan(mac: String) -> Result<(), String> {
    let packet = magic_packet(&mac)?;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    socket.send_to(&packet, "255.255.255.255:9").map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_magic_packet() {
        let p = magic_packet("AA:bb:cc:dd:ee:01").unwrap();
        assert_eq!(p.len(), 102);
        assert!(p[..6].iter().all(|b| *b == 0xFF));
        assert_eq!(&p[6..12], &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01]);
        assert_eq!(&p[96..102], &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01]);
        assert_eq!(magic_packet("aa-bb-cc-dd-ee-01").unwrap(), p);
    }

    #[test]
    fn refuses_bad_addresses() {
        for bad in ["", "aa:bb:cc", "aa:bb:cc:dd:ee:zz", "aabbccddeeff", "aa:bb:cc:dd:ee:ff:00", "a:bb:cc:dd:ee:ff"] {
            assert!(magic_packet(bad).is_err(), "{bad}");
        }
    }
}
