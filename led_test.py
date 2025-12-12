import sys
import time

try:
    from rpi_ws281x import PixelStrip, Color, WS2811_STRIP_GRB
except Exception as exc:  # pragma: no cover - hardware import guard
    sys.stderr.write(f"[led_test] Kon rpi_ws281x niet importeren: {exc}\n")
    sys.exit(1)


LED_COUNT = 300
LED_PIN = 18  # GPIO18 (PWM)
LED_FREQ_HZ = 800000
LED_DMA = 10
LED_INVERT = False
LED_BRIGHTNESS = 255
LED_CHANNEL = 0
LED_STRIP_TYPE = WS2811_STRIP_GRB


def run():
    try:
        strip = PixelStrip(LED_COUNT, LED_PIN, LED_FREQ_HZ, LED_DMA, LED_INVERT, LED_BRIGHTNESS, LED_CHANNEL, LED_STRIP_TYPE)
        init_res = strip.begin()
    except Exception as exc:
        sys.stderr.write(f"[led_test] ws2811_init failed: {exc}\n")
        sys.exit(1)

    if init_res is False:
        sys.stderr.write("[led_test] ws2811_init failed (return False)\n")
        sys.exit(1)

    def show_color(name, rgb):
        print(f"[led_test] {name}")
        for i in range(strip.numPixels()):
            strip.setPixelColor(i, Color(*rgb))
        strip.show()
        time.sleep(3)

    show_color("Rood", (255, 0, 0))
    show_color("Groen", (0, 255, 0))
    show_color("Blauw", (0, 0, 255))

    print("[led_test] Uit")
    for i in range(strip.numPixels()):
        strip.setPixelColor(i, Color(0, 0, 0))
    strip.show()


if __name__ == "__main__":
    run()
