#include "utils.h"

gchar* getStr(Handle<Object> opts, const gchar* name) {
  NanUtf8String* str = NULL;
  if (opts->Has(H(name))) {
    Handle<Value> opt = opts->Get(H(name));
    if (opt->IsString()) {
      str = new NanUtf8String(opt);
    }
  }
  if (str != NULL && str->Size() > 1) {
    return **str;
  } else {
    return NULL;
  }
}

