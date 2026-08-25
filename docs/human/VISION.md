# What we are building

Install: [`START-HERE.md`](./START-HERE.md).  
How it is built: [`CONCEPTS.md`](./CONCEPTS.md).  
How it ages: [`LIFECYCLE.md`](./LIFECYCLE.md).

You run a business by **talking**. The agent looks up real context, does the work (or queues it), leaves a trace, and answers. Screens are for other people.

**Build time:** IDE agent installs (DEV).  
**Run time:** you talk; optional `/console` on the phone.  
**Cheap capable models** handle most orders. A stronger model is only for rare hard cases.

A chatbot replies. This stack is an **operating system**: local secrets, audit, background jobs, copyable universes. Client apps stay outside the operator cockpit.

The same brick shape repeats from one package to a fleet. DEV may break. TEST is born empty and then deleted. PROD moves by git tag.

```
Install DEV → prove the loop → learn the fractal → TEST from scratch
    → tag → PROD → then business apps
```
