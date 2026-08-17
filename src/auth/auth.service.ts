import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from '../common/dto';
import { AuthUser } from './auth.types';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('An account with that email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      email,
      passwordHash,
      name: dto.name,
    });

    await this.prisma.share.updateMany({
      where: { recipientEmail: email, recipientId: null, revokedAt: null },
      data: { recipientId: user.id },
    });

    return this.issueSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const matches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user);
  }

  private issueSession(user: { id: string; email: string; name: string }) {
    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    const profile: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
    };
    return { token, user: profile };
  }
}
