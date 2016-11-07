lib: ./build
	node-gyp build
	node src/navigator.js > navigator.json

./build:
	node-gyp configure

clean:
	rm -rf ./build
	rm -rf ./lib
	rm -f test.trace
	rm -f test/shots/*

check: lib
	mocha -R spec

.PHONY: lib
