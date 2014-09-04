#ifndef WEBKITGTK_RUNNABLE_H
#define WEBKITGTK_RUNNABLE_H

#include <map>
#include <nan.h>

class Runnable {
public:
  static const int RAN_SCRIPT = 1;
  static const int RAN_FINISH = 2;

  char* ticket = NULL;
  NanCallback* callback = NULL;
  NanUtf8String* script = NULL;
  NanUtf8String* finish = NULL;
  bool sync;
  int state;
  void* view = NULL;

  Runnable(void*);
  ~Runnable();
};

#endif
