#ifndef WEBKITGTK_SOUPHEADERS_H
#define WEBKITGTK_SOUPHEADERS_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include "utils.h"

using namespace v8;

class SoupHeaders : public node::ObjectWrap {
public:
  static Persistent<FunctionTemplate> constructor;
  static void Init(Handle<Object>);
  static NAN_METHOD(New);

  SoupMessageHeaders* headers = NULL;

  SoupHeaders();
  void init(SoupMessageHeaders*);

private:
  ~SoupHeaders();
};

#endif
