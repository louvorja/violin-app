# Áudios litúrgicos

Vêm com o programa e aparecem na Biblioteca de Mídia, na categoria
**Litúrgicos** (`src/config/LiturgicalAudios.ts`).

| Arquivo | Na biblioteca |
| --- | --- |
| `../sabbath-school/opening.mp3` | Abertura da Escola Sabatina |
| `opening_classic.mp3` | Abertura da Escola Sabatina (Clássico) |
| `../sabbath-school/five_minutes.mp3` | 5 minutos para a Lição |
| `five_minutes_classic.mp3` | 5 minutos para a Lição (Clássico) |
| `../sabbath-school/one_minute.mp3` | 1 minuto para a Lição |
| `one_minute_classic.mp3` | 1 minuto para a Lição (Clássico) |
| `announcements_1.mp3` | Anúncios v1 |
| `announcements_2.mp3` | Anúncios v2 |
| `intercessory_prayer.mp3` | Oração Intercessória |
| `closing.mp3` | Encerramento do Culto (sábado) |
| `closing_weekday.mp3` | Encerramento do Culto (quarta e domingo) |

Os três da Escola Sabatina são também os que o Temporizador de Culto toca por
padrão. Os avisos tocam 10 s antes da marca (5:10 e 1:10, como no Clássico),
então nos de 5 e 1 minuto a voz diz o número uns 10 s depois do início do
áudio, junto com a virada para 5:00 e 1:00. Ao trocar esses arquivos, mantenha
essa folga. O de 1 minuto dura 1:10 e segue com fundo musical até o fim da
contagem, para a oração final da lição.
Os encerramentos seguem com a música depois da locução, enquanto a igreja sai.
A Oração Intercessória é só a voz: o fundo é o que o usuário escolhe na
biblioteca e entra quando a locução termina.

Os "(Clássico)" são os sons que o Temporizador de Culto tocava antes, para
quem preferir: basta escolhê-los na janela "Áudios" do temporizador.

Vozes e fundos musicais gerados com o ElevenLabs (os "(Clássico)" não). O crédito ("ElevenLabs")
fica no campo `credit` de cada áudio e aparece junto do nome na biblioteca.

Para trocar um áudio, basta substituir o arquivo com o mesmo nome. Formato:
MP3 estéreo, 44,1 kHz, 192 kbps, volume em -16 LUFS (todos no mesmo nível).
