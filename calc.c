#include <stdio.h>
#include <stdlib.h>

int main(void)
{
    char line[256];

    puts("Simple calculator. Type an expression like: 3 + 4");
    puts("Type 'q' (or press Ctrl-D) to quit.");

    for (;;) {
        fputs("> ", stdout);

        /* Read one line. fgets returns NULL on EOF (Ctrl-D). */
        if (fgets(line, sizeof line, stdin) == NULL) {
            putchar('\n');
            break;
        }

        /* Let the user quit by typing q. */
        if (line[0] == 'q')
            break;

        double a, b;
        char op;

        /* Pull two numbers and an operator out of the line.
           " %lf %c %lf" skips leading spaces and reads: number, op, number.
           sscanf returns how many items it successfully matched. */
        if (sscanf(line, " %lf %c %lf", &a, &op, &b) != 3) {
            puts("  ?  expected: <number> <op> <number>");
            continue;
        }

        double result;
        switch (op) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        case '/':
            if (b == 0) {
                puts("  ?  cannot divide by zero");
                continue;
            }
            result = a / b;
            break;
        default:
            printf("  ?  unknown operator '%c'\n", op);
            continue;
        }

        printf("  = %g\n", result);
    }

    return 0;
}
