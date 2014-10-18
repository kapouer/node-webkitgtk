#ifndef WEBKITGTK_UTILS_H
#define WEBKITGTK_UTILS_H

#define ATTR(t, name, get, set) t->InstanceTemplate()->SetAccessor(NanNew(name), get, set);
#define TOSTR(obj) (*String::Utf8Value((obj)->ToString()))
#define H(name) NanNew<String>(name)

#include <nan.h>
#include <glib.h>

using namespace v8;

gchar* getStr(Handle<Object>, const gchar*);

#endif

