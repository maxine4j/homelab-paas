import z from 'zod';

export type ServiceDescriptor = z.infer<typeof ServiceDescriptor>;
export const ServiceDescriptor = z.object({
  serviceId: z.string().max(16),
  image: z.string(),
  networking: z.object({
    ingress: z.object({
      containerPort: z.number().min(1).max(65_535),
      public: z.boolean().optional(),
      authorizedUsers: z.array(z.string()).optional(),
    }),
    serviceProxy: z
      .object({
        ingress: z.array(z.string()).optional(),
        egress: z.array(z.string()).optional(),
      })
      .optional(),
    hostPorts: z
      .array(
        z.object({
          containerPort: z.number().min(1).max(65_535),
          hostPort: z.number().min(1).max(65_535),
          protocol: z.union([z.literal('tcp'), z.literal('udp')]).optional(),
        }),
      )
      .optional(),
  }),
  environment: z.record(z.string(), z.string()).optional(),
  volumes: z
    .array(
      z.object({
        hostPath: z.string(),
        containerPath: z.string(),
      }),
    )
    .optional(),
});
