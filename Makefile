lib: ./build
	node-gyp build

./build:
	node-gyp configure

clean:
	rm -rf ./build
	rm -rf ./lib
	rm -f test.trace
	rm -f test/shots/*

check: lib
	mocha --reporter=progress

.PHONY: lib
