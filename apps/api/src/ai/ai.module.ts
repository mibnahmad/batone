import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER, AiProvider } from './ai-provider.interface';
import { AiGatewayService } from './ai-gateway.service';
import { AnthropicProvider } from './anthropic.provider';
import { ClarificationService } from './clarification.service';
import { LocalInferenceProvider } from './local-inference.provider';
import { ClarificationsController } from './clarifications.controller';

@Global()
@Module({
  controllers: [ClarificationsController],
  providers: [
    LocalInferenceProvider,
    ClarificationService,
    AiGatewayService,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService, LocalInferenceProvider],
      useFactory: (config: ConfigService, local: LocalInferenceProvider): AiProvider => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (apiKey && apiKey.trim().length > 0) {
          const model = config.get<string>('AI_MODEL') ?? 'claude-sonnet-4-20250514';
          Logger.log(`Fournisseur IA : Anthropic (${model})`, 'AiModule');
          return new AnthropicProvider(apiKey, model);
        }
        Logger.log(
          "Fournisseur IA : moteur déterministe local (aucune clé ANTHROPIC_API_KEY configurée).",
          'AiModule',
        );
        return local;
      },
    },
  ],
  exports: [AiGatewayService, ClarificationService, AI_PROVIDER],
})
export class AiModule {}
