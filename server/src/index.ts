import { handle } from './http';

export default {
  fetch(request: Request, env: unknown): Promise<Response> {
    return handle(request, env);
  },
};
