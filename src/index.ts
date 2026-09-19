export { Client } from "./client.js";
export type {
  ClientOptions,
  SendMessage,
  Attachment,
  Address,
  EmailGroup,
  GroupList,
  MappingNode,
  MappingEdge,
  MappingGraph,
  MappingNodeType,
} from "./types.js";
export { SendResult } from "./send-result.js";
export {
  ProxyMailerError,
  AuthenticationError,
  ValidationError,
  RateLimitError,
  ApiError,
} from "./errors.js";
