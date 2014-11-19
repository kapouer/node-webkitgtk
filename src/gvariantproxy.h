#ifndef WEBKITGTK_GVARIANTPROXY_H
#define WEBKITGTK_GVARIANTPROXY_H

#include <node.h>
#include <nan.h>
#include "utils.h"

using namespace v8;

class GVariantProxy : public node::ObjectWrap {
public:
	static Persistent<FunctionTemplate> constructor;
	static void Init(Handle<Object>);
	static NAN_METHOD(New);

	GVariantDict* dict = NULL;
	GVariant* variant = NULL;

	GVariantProxy();
	void init(GVariant*);

private:
	~GVariantProxy();
};

#endif
