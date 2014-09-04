lib: ./build
	mkdir -p lib/ext
	node-gyp build

./build:
	node-gyp configure

clean:
	rm -rf ./build
	rm -f ./lib/*.node
	rm -f ./lib/ext/*.so
	rm -f test.trace
	rm -f test/shots/*

check: lib
	mocha

.PHONY: lib
