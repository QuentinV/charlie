#include <WiFi.h>
#include <WiFiUdp.h>

WiFiUDP udp;
const char* serverIP = "192.168.1.100"; // your server's IP
const int serverPort = 12345;

void sendAudio(uint8_t* audioData, size_t length) {
  udp.beginPacket(serverIP, serverPort);
  udp.write(audioData, length);
  udp.endPacket();
}
