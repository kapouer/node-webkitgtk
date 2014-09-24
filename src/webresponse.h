#ifndef WEBKITGTK_WEBRESPONSE_H
#define WEBKITGTK_WEBRESPONSE_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include "utils.h"

using namespace v8;

class WebResponse : public node::ObjectWrap {
public:
  static Persistent<FunctionTemplate> constructor;
  static void Init(Handle<Object>);
  static NAN_METHOD(New);
  static void DataFinished(GObject*, GAsyncResult*, gpointer);

  WebKitURIResponse* response = NULL;
  WebKitWebResource* resource = NULL;

  WebResponse();
  void init(WebKitWebResource*, WebKitURIResponse*);

private:
  ~WebResponse();
  NanCallback* dataCallback = NULL;

  static NAN_GETTER(get_prop);
  // static NAN_SETTER(set_prop);

  static NAN_METHOD(Data);
};

#endif
