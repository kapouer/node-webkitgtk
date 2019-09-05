#ifndef WEBKITGTK_WEBREQUEST_H
#define WEBKITGTK_WEBREQUEST_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include "utils.h"

class WebRequest : public node::ObjectWrap {
public:
	static Nan::Persistent<v8::FunctionTemplate> constructor;
	static void Init(v8::Local<v8::Object>);
	static NAN_METHOD(New);

	WebKitURIRequest* request = NULL;

	WebRequest();
	void init(WebKitURIRequest*);

private:
	~WebRequest();

	static NAN_GETTER(get_prop);
};

#endif
