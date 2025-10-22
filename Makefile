permission:
# 	sudo chmod a+rw /dev/ttyUSB0
	sudo chmod a+rw /dev/ttyACM0

upload_html:
	~/.platformio/penv/bin/pio run -t uploadfs